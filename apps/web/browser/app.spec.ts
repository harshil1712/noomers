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
      case "paths":
        return route.fulfill({
          json: {
            page: 1,
            hasNextPage: false,
            countsByProperty: [
              ["/guides/self-hosted-analytics", 17, 29],
              ["/pricing", 8, 11],
            ],
          },
        });
      case "country":
        return route.fulfill({
          json: {
            page: 1,
            hasNextPage: false,
            countsByProperty: [
              [["US", "United States"], 12, 15],
              [["IN", "India"], 9, 11],
            ],
          },
        });
      case "referrer":
        return route.fulfill({
          json: {
            page: 1,
            hasNextPage: false,
            countsByProperty: [
              ["", 12, 13],
              ["news.ycombinator.com", 9, 10],
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
  await page.goto("/settings?section=sites");
  await expect(page.getByText("Couldn’t load your sites")).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Couldn’t load your sites")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "example.org", exact: true })).toBeVisible();
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
  await page.getByRole("tab", { name: "API keys" }).click();
  await page.getByPlaceholder("e.g. Grafana").fill("Reporting");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByRole("button", { name: "Copy API key" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: "Revoke key", exact: true }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
});

test("an owner can find a lower-ranked page, filter the dashboard and return", async ({ page }) => {
  await serveApp(page, true);
  const paths = Array.from({ length: 13 }, (_, i) => [`/guides/article-${i + 1}`, 40 - i, 60 - i]);
  await page.route(
    (url) => url.pathname === "/api/dashboard/paths",
    (route) => {
      const query = new URL(route.request().url()).searchParams;
      const pageNumber = Number(query.get("page") || 1);
      const filtered = paths.filter((row) => !query.get("path") || row[0] === query.get("path"));
      return route.fulfill({
        json: {
          countsByProperty: filtered.slice((pageNumber - 1) * 10, pageNumber * 10),
          page: pageNumber,
          hasNextPage: filtered.length > pageNumber * 10,
        },
      });
    },
  );
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: domain, exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Reporting period" })).toContainText(
    "Last 24 hours",
  );
  const table = page.getByRole("table").filter({ hasText: "/guides/article-" });
  await expect(table.getByText("/guides/article-10", { exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Pageviews" })).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(table.getByText("/guides/article-13")).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  await table.getByRole("button", { name: "/guides/article-10", exact: true }).press("Enter");
  await expect(page).toHaveURL(/path=%2Fguides%2Farticle-10/i);
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove path filter" }).click();
  await expect(table.getByRole("row")).toHaveCount(11);
});

test("an owner can find Settings, save one site's timezone and keep another edit", async ({
  page,
}) => {
  await serveApp(page, true);
  const details = [
    { domain, timezone: "America/New_York" },
    { domain: "docs.example.org", timezone: "Europe/London" },
  ];
  await page.route(
    (url) => url.pathname === "/api/dashboard/sites",
    (route) => route.fulfill({ json: { sites: details.map((s) => s.domain), details } }),
  );
  await page.route("**/api/dashboard/sites/example.org", (route) => {
    const { timezone } = route.request().postDataJSON();
    details[0].timezone = timezone;
    return route.fulfill({ json: details[0] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Sites", exact: true }).click();
  const row = (domain: string) =>
    page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ has: page.getByText(domain, { exact: true }) });
  async function change(domain: string, zone: string) {
    await row(domain).getByRole("combobox").click();
    await page.getByPlaceholder("Search timezones").fill(zone);
    await page.getByRole("option", { name: zone, exact: true }).click();
  }
  await change("docs.example.org", "Asia/Tokyo");
  await change(domain, "UTC");
  await row(domain).getByRole("button", { name: "Save timezone" }).click();
  await expect(row(domain).getByRole("button", { name: "Save timezone" })).toBeDisabled();
  await expect(row("docs.example.org").getByRole("combobox")).toContainText("Asia/Tokyo");
  await expect(
    row("docs.example.org").getByRole("button", { name: "Save timezone" }),
  ).toBeEnabled();
  await page.reload();
  await expect(row(domain).getByRole("combobox")).toContainText("UTC");
  await row(domain).getByRole("button", { name: "Delete site" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("button", { name: "Delete site" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(row(domain)).toBeVisible();
});

test("a disconnected realtime feed does not pass its last count off as live", async ({ page }) => {
  await serveApp(page, true);
  let close = () => {};
  await page.routeWebSocket("**/realtime/*", (socket) => {
    socket.send(
      JSON.stringify({
        currentVisitors: 12,
        visitors30m: 19,
        pageviews30m: 28,
        topPages: [],
        topReferrers: [],
        topCountries: [],
      }),
    );
    close = () => socket.close();
  });
  await page.goto("/dashboard?site=example.org&tab=realtime");
  await expect(page.getByRole("heading", { name: "12", exact: true })).toBeVisible();
  close();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "12", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
});

test("an owner can use mobile navigation and return to the sites overview", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveApp(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Sites", exact: true })).toBeVisible();
});

test("quick navigation explains empty results and closes after choosing a page", async ({
  page,
}) => {
  await serveApp(page, true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sites", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  const search = page.getByPlaceholder("Switch site or jump to a page…");
  await search.fill("unmatched-site");
  await expect(page.getByText("No matching sites or pages.")).toBeVisible();
  await search.fill("Settings");
  await page.getByRole("option", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(search).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(search).toHaveValue("");
});
