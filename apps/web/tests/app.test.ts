/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { migrate, signUp, verifyLatest, PASSWORD } from "./helpers";

// The always-pass test secret accepts any token; "" exercises the missing-token path.
const CAPTCHA = { "x-captcha-response": "test-token" };

describe("worker", () => {
  beforeAll(migrate);

  it("GET /api/health returns the compat liveness body", async () => {
    const r = await SELF.fetch("https://x/api/health");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });

  it("auth surface responses carry security headers", async () => {
    const r = await SELF.fetch("https://x/api/public-config");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("strict-transport-security")).toContain("max-age");
    expect(r.headers.get("content-security-policy")).toContain("challenges.cloudflare.com");
  });

  it("unknown /api route is JSON 404", async () => {
    const r = await SELF.fetch("https://x/api/nope");
    expect(r.status).toBe(404);
    expect(await r.json<{ error: string }>()).toEqual({ error: "not found" });
  });

  it("/api/public-config returns the test site key", async () => {
    const r = await SELF.fetch("https://x/api/public-config");
    const j = await r.json<{ turnstileSiteKey: string; googleEnabled: boolean }>();
    expect(j.turnstileSiteKey).toBe("1x00000000000000000000AA");
    expect(j.googleEnabled).toBe(false);
  });
});

describe("auth", () => {
  beforeAll(migrate);

  it("SIGNUP_DISABLED=true closes sign-ups but sign-in still works", async () => {
    // Seed a verified user with the flag off first.
    const email = `disabled-${crypto.randomUUID()}@t.dev`;
    await signUp(email);
    await verifyLatest(email);

    const saved = env.SIGNUP_DISABLED;
    env.SIGNUP_DISABLED = "true";
    try {
      const closedEmail = `closed-${crypto.randomUUID()}@t.dev`;
      const closed = await signUp(closedEmail);
      expect(closed.status).not.toBe(200);
      const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
        .bind(closedEmail)
        .first();
      expect(row).toBeNull();

      const config = await SELF.fetch("https://x/api/public-config");
      expect((await config.json<{ signupEnabled: boolean }>()).signupEnabled).toBe(false);

      // Existing accounts still sign in.
      const login = await SELF.fetch("https://x/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-captcha-response": "test" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(login.status).toBe(200);
    } finally {
      env.SIGNUP_DISABLED = saved;
    }
  });

  it("public-config reports sign-ups open (SIGNUP_DISABLED=false in test bindings)", async () => {
    const config = await SELF.fetch("https://x/api/public-config");
    expect((await config.json<{ signupEnabled: boolean }>()).signupEnabled).toBe(true);
  });

  it("sign-up without a captcha token is rejected", async () => {
    const r = await signUp(`nocap-${crypto.randomUUID()}@t.dev`, "");
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("sign-up with the always-pass token sends a verification email; sign-in is refused until verified", async () => {
    const email = `u-${crypto.randomUUID()}@t.dev`;
    const r = await signUp(email);
    expect(r.status).toBe(200);

    const sent = await env.DB.prepare("SELECT subject, html FROM sent_email WHERE to_addr = ?")
      .bind(email)
      .first();
    expect(sent).toBeTruthy();

    const denied = await SELF.fetch("https://x/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...CAPTCHA },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);

    await verifyLatest(email);
    const ok = await SELF.fetch("https://x/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...CAPTCHA },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(ok.status).toBe(200);
  });

  it("admin list-users: 403 for a normal user, 200 for the owner after verification", async () => {
    // normal user
    const email = `n-${crypto.randomUUID()}@t.dev`;
    await signUp(email);
    const v = await verifyLatest(email);
    const cookies = v.headers.get("set-cookie") ?? "";
    const r1 = await SELF.fetch("https://x/api/auth/admin/list-users", {
      headers: { cookie: cookies },
    });
    expect(r1.status).toBe(403);

    // owner (OWNER_ADMIN_EMAIL=owner@example.com) — verify first, then the
    // admin plugin sees role=admin from the bootstrap hook.
    const rv = await signUp("owner@example.com");
    expect(rv.status).toBe(200);
    const v2 = await verifyLatest("owner@example.com");
    const r2 = await SELF.fetch("https://x/api/auth/admin/list-users", {
      headers: { cookie: v2.headers.get("set-cookie") ?? "" },
    });
    expect(r2.status).toBe(200);
  });

  it("delete-user: wrong password is refused; the right one deletes the account", async () => {
    const email = `d-${crypto.randomUUID()}@t.dev`;
    await signUp(email);
    const v = await verifyLatest(email);
    const headers = {
      "content-type": "application/json",
      cookie: v.headers.get("set-cookie") ?? "",
      // Cookie-authenticated POSTs must come from a trusted origin (BETTER_AUTH_URL).
      origin: "http://localhost:8787",
    };

    const wrong = await SELF.fetch("https://x/api/auth/delete-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "not-the-password" }),
    });
    expect(wrong.status).toBe(400);

    const ok = await SELF.fetch("https://x/api/auth/delete-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(ok.status).toBe(200);

    const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first();
    expect(row).toBeNull();
  });
});
