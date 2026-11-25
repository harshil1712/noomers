import { expect, test, type Page } from "@playwright/test";

const owner = {
  session: { id: "session" },
  user: { id: "owner", name: "Site owner", email: "owner@example.org", role: "admin" },
};
const domain = "example.org";
const sites = { sites: [domain], details: [{ domain, timezone: "UTC" }] };

async function serveApp(page: Page, signedIn: boolean) {
  await page.route("**/api/public-config", (route) =>
    route.fulfill({ json: { signupEnabled: true, googleEnabled: false, turnstileSiteKey: "" } }),
  );
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ json: signedIn ? owner : null }),
  );
  await page.route("**/api/auth/list-accounts", (route) =>
    route.fulfill({ json: [{ providerId: "credential" }] }),
  );
  await page.route("**/api/dashboard/**", (route) => {
    const path = new URL(route.request().url()).pathname.split("/").pop();
    switch (path) {
      case "sites":
        return route.fulfill({ json: sites });
      case "stats":
        return route.fulfill({ json: { views: 40, visitors: 21, visits: 23 } });
      case "timeseries":
        return route.fulfill({
          json: {
            chartData: [
              { date: "2026-01-01", views: 18, visitors: 9, bounceRate: 0 },
              { date: "2026-01-02", views: 22, visitors: 12, bounceRate: 0 },
            ],
          },
        });
      case "goals":
        return route.fulfill({ json: { goals: [] } });
      case "api-keys":
        return route.fulfill({ json: { api_keys: [] } });
      default:
        return route.fulfill({ json: { countsByProperty: [], page: 1 } });
    }
  });
  await page.routeWebSocket("**/realtime/*", (socket) => {
    socket.send(
      JSON.stringify({
        currentVisitors: 3,
        visitors30m: 8,
        pageviews30m: 12,
        pageviewsPerMinute: [],
        topPages: [],
        topReferrers: [],
        topCountries: [],
      }),
    );
  });
}

test("switching dashboard metrics and themes reuses the current period", async ({ page }) => {
  await serveApp(page, true);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/dashboard/timeseries?")) requests.push(request.url());
  });
  await page.goto("/dashboard?site=example.org");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: /^Pageviews 40/ }).click();
  await expect(page.getByRole("button", { name: /^Pageviews 40/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /Switch to .* mode/ }).click();
  await page.getByRole("combobox", { name: "Reporting period" }).click();
  await page.getByRole("option", { name: "Today", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.map((url) => new URL(url).searchParams.get("interval"))).toEqual(["7d", "day"]);
  await page.getByRole("button", { name: "Tracking code" }).click();
  await expect(page.getByRole("dialog")).toContainText(domain);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Realtime" }).click();
  await expect(page.getByText("current visitors", { exact: true })).toBeVisible();
});

test("settings can recover a failed site list in place", async ({ page }) => {
  await serveApp(page, true);
  let unavailable = true;
  await page.route(
    (url) => url.pathname === "/api/dashboard/sites",
    (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: "Unavailable" } })
        : route.fulfill({ json: sites }),
  );
  await page.goto("/settings");
  await expect(page.getByText("Couldn’t load your sites")).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Couldn’t load your sites")).toHaveCount(0);
  await expect(page.getByText("Reporting timezone for example.org")).toBeVisible();
  await page.getByRole("button", { name: "Sign out other sessions" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("sign-in masks typed passwords and announces rejected credentials", async ({ page }) => {
  await serveApp(page, false);
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ status: 401, json: { code: "INVALID_EMAIL_OR_PASSWORD" } }),
  );
  await page.goto("/sign-in");
  const password = page.locator('input[autocomplete="current-password"]');
  await page.getByLabel("Email", { exact: false }).fill(owner.user.email);
  await password.fill("fixture-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(password).toHaveAttribute("aria-invalid", "true");
});

test("signup, verification and password recovery show their next step", async ({ page }) => {
  await serveApp(page, false);
  for (const path of [
    "sign-up/email",
    "request-password-reset",
    "reset-password",
    "send-verification-email",
  ])
    await page.route("**/api/auth/" + path, (route) => route.fulfill({ json: { status: true } }));
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: false }).fill("Site owner");
  await page.getByLabel("Email", { exact: false }).fill(owner.user.email);
  await page.locator('input[autocomplete="new-password"]').fill("fixture-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend in/ })).toBeDisabled();
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: false }).fill(owner.user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto("/reset-password");
  await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
  await page.goto("/reset-password?token=fixture");
  await page.locator('input[autocomplete="new-password"]').fill("new-fixture-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
});

test("adding the first site leads to its tracking snippet", async ({ page }) => {
  await serveApp(page, true);
  await page.route(
    (url) => url.pathname === "/api/dashboard/sites",
    (route) =>
      route.fulfill({
        json:
          route.request().method() === "POST"
            ? { domain, timezone: "UTC", trackerId: "example" }
            : { sites: [], details: [] },
      }),
  );
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Add site" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Domain", { exact: false }).fill(domain);
  await dialog.getByRole("button", { name: "Add site" }).click();
  await expect(dialog.getByRole("button", { name: "Open dashboard" })).toBeVisible();
  await expect(dialog).toContainText(domain);
});

for (const width of [390, 1280])
  for (const mode of ["light", "dark"] as const) {
    test(`app routes fit at ${width}px in ${mode} mode`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await serveApp(page, false);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const routes = [
        ["/sign-in", "Sign in"],
        ["/sign-up", "Create account"],
        ["/forgot-password", "Reset password"],
        ["/reset-password?token=fixture", "Choose a new password"],
        ["/check-email?email=owner%40example.org", "Check your email"],
        ["/", "Sites"],
        ["/settings", "Settings"],
        ["/dashboard?site=example.org", domain],
        ["/dashboard?site=example.org&tab=realtime", domain],
      ];
      for (const [index, [path, title]] of routes.entries()) {
        if (path === "/")
          await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: owner }));
        await page.goto(path);
        await expect(
          page.getByRole("heading", { level: 1, name: title, exact: true }),
        ).toBeVisible();
        if (path === "/settings") await expect(page.getByText("No API keys yet.")).toBeVisible();
        if (path === "/" || path.endsWith("site=example.org"))
          await expect(page.locator("canvas").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
        expect(
          await page.locator("main").evaluate((el) => el.scrollWidth - el.clientWidth),
          path,
        ).toBeLessThanOrEqual(1);
        await page.screenshot({ path: info.outputPath(`${index}.png`), animations: "disabled" });
      }
      expect(errors).toEqual([]);
    });
  }

test("settings validates credentials and creates and revokes a key", async ({ page }) => {
  await serveApp(page, true);
  let created = false;
  let revoked = false;
  const apiKey = {
    id: "fixture",
    name: "Reporting",
    prefix: "test",
    scope: "stats",
    created_at: 1,
    last_used_at: null,
  };
  await page.route(
    (url) => url.pathname.startsWith("/api/dashboard/api-keys"),
    (route) => {
      if (route.request().method() === "DELETE") {
        revoked = true;
        return route.fulfill({ json: { revoked: true } });
      }
      if (route.request().method() === "POST") {
        created = true;
        return route.fulfill({ json: { ...apiKey, key: "fixture-only" } });
      }
      return route.fulfill({
        json: { api_keys: created ? [{ ...apiKey, revoked_at: revoked ? 1 : null }] : [] },
      });
    },
  );
  await page.route("**/api/auth/change-password", (route) =>
    route.fulfill({ status: 400, json: { code: "INVALID_PASSWORD" } }),
  );
  await page.goto("/settings");
  const current = page.locator('input[autocomplete="current-password"]');
  await current.fill("incorrect-fixture");
  await page.locator('input[autocomplete="new-password"]').fill("replacement-fixture");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(current).toBeFocused();
  await expect(page.getByText("That password isn't right.")).toBeVisible();
  await page.getByPlaceholder("e.g. Grafana").fill("Reporting");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByRole("button", { name: "Copy API key" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: "Revoke key", exact: true }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
});
