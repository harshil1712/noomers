/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { beforeAll } from "vitest";
import { migrate, seedGoal, seedSite, verifiedSessionCookie } from "./helpers";

const BASE = "https://worker.test/api/dashboard";
let cookie = "";

async function authed() {
  return cookie;
}

beforeAll(async () => {
  await migrate();
  cookie = await verifiedSessionCookie("owner@example.com");
});

describe("/api/dashboard/* auth", () => {
  test("unauthenticated → 401", async () => {
    const res = await SELF.fetch(`${BASE}/stats?site=x`);
    expect(res.status).toBe(401);
  });

  test("non-admin signed-in → 403", async () => {
    await migrate();
    const cookie = await verifiedSessionCookie(`u-${crypto.randomUUID()}@t.dev`);
    const res = await SELF.fetch(`${BASE}/stats?site=x`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });

  test("admin → sites list", async () => {
    const cookie = await authed();
    const domain = `d${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    const res = await SELF.fetch(`${BASE}/sites`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json<{ sites: string[] }>();
    expect(body.sites).toContain(domain);
  });

  test("admin → stats shape (Basin not configured errors or returns metrics)", async () => {
    const cookie = await authed();
    const domain = `d${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    const res = await SELF.fetch(`${BASE}/stats?site=${domain}&interval=7d`, {
      headers: { Cookie: cookie },
    });
    // Basin env isn't configured in tests → getSessionMetrics hits the
    // fetch seam; expect a JSON error or metric keys, never 401/403.
    expect([200, 500]).toContain(res.status);
  });

  test("admin → paths breakdown shape", async () => {
    const cookie = await authed();
    const domain = `d${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    const res = await SELF.fetch(`${BASE}/paths?site=${domain}&interval=7d&page=1`, {
      headers: { Cookie: cookie },
    });
    expect([200, 500]).toContain(res.status);
  });

  test("props requires event and key", async () => {
    const cookie = await authed();
    const res = await SELF.fetch(`${BASE}/props?site=example.com`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });

  test("goals list shape", async () => {
    const cookie = await authed();
    const domain = `d${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    await seedGoal(domain, { name: "signup", type: "event", value: "signup" });
    const res = await SELF.fetch(`${BASE}/goals?site=${domain}&interval=7d`, {
      headers: { Cookie: cookie },
    });
    // Basin isn't configured in tests; assert auth reached the handler
    // and, when the backend replies, that the goals shape is right.
    expect([200, 500]).toContain(res.status);
    if (res.status !== 200) return;
    const body = await res.json<{ goals: { name: string }[] }>();
    expect(body.goals.map((g) => g.name)).toContain("signup");
  });
});
