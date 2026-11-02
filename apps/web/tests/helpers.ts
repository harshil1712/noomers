import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { expect } from "vite-plus/test";

// The hand-maintained migrations (drizzle-kit generate is/was broken — see
// migrations/README.md) are applied exactly as alchemy applies them, proving
// they work unmodified.
let migrated = false;
export async function migrate() {
  if (migrated) return;
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS sent_email (to_addr text, subject text, text text, html text)",
  );
  migrated = true;
}

export const PASSWORD = "test-password-123";

export async function signUp(email: string, captchaToken = "test-token") {
  return SELF.fetch("https://x/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-captcha-response": captchaToken },
    body: JSON.stringify({ name: "T", email, password: PASSWORD }),
  });
}

export async function verifyLatest(email: string) {
  // Pull the verification URL out of the email the sink captured.
  const row = await env.DB.prepare(
    "SELECT text FROM sent_email WHERE to_addr = ? ORDER BY rowid DESC LIMIT 1",
  )
    .bind(email)
    .first<{ text: string }>();
  const url = row?.text.match(/https?:\/\/\S+/)?.[0];
  expect(url).toBeTruthy();
  // redirect:manual — the session cookie lives on the 302, not the target.
  return SELF.fetch(url!, { redirect: "manual" });
}

export async function signIn(email: string) {
  return SELF.fetch("https://x/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-captcha-response": "test-token",
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

/** Sign up (or sign in if the user exists), verify, and return the session
 * cookie header value. */
export async function verifiedSessionCookie(email: string) {
  // Sign-in on an unknown email throws APIError inside the worker, which
  // surfaces to Vitest as an unhandled error — check D1 first instead.
  const exists = await env.DB.prepare("SELECT 1 FROM user WHERE email = ?").bind(email).first();
  if (exists) {
    const signedIn = await signIn(email);
    if (signedIn.ok) {
      return signedIn.headers.get("set-cookie") ?? "";
    }
  }
  await signUp(email);
  const v = await verifyLatest(email);
  return v.headers.get("set-cookie") ?? "";
}

// --- noomers analytics seeds ------------------------------------------------

/** Insert a sites row directly — the v1 route tests seed the registry rather
 * than going through the API under test. */
export async function seedSite(
  domain: string,
  opts: { timezone?: string; plausibleScriptId?: string | null; trackerConfig?: object } = {},
) {
  await env.DB.prepare(
    `INSERT INTO sites (domain, tracker_id, timezone, tracker_script_configuration, plausible_script_id)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      domain,
      crypto.randomUUID(),
      opts.timezone ?? "Etc/UTC",
      JSON.stringify(opts.trackerConfig ?? {}),
      opts.plausibleScriptId ?? null,
    )
    .run();
}

export async function seedGoal(
  siteId: string,
  goal: {
    id?: string;
    name: string;
    type: "event" | "pageview";
    value: string;
    customProps?: object;
  },
) {
  const id = goal.id ?? crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO goals (id, site_id, name, type, value, custom_props) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, siteId, goal.name, goal.type, goal.value, JSON.stringify(goal.customProps ?? {}))
    .run();
  return id;
}

export async function seedCustomProperty(siteId: string, property: string) {
  await env.DB.prepare(`INSERT INTO custom_properties (site_id, property) VALUES (?, ?)`)
    .bind(siteId, property)
    .run();
}
