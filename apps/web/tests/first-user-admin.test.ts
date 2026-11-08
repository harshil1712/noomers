/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { migrate, signUp, verifyLatest, signIn, PASSWORD } from "./helpers";

const DASH = "https://worker.test/api/dashboard/sites";
const CONFIG = "https://x/api/public-config";

function demoteAll(): Promise<unknown> {
  return env.DB.prepare("UPDATE user SET role = 'user'").run();
}

function roleOf(email: string) {
  return env.DB.prepare("SELECT role FROM user WHERE email = ?").bind(email).first<{
    role: string | null;
  }>();
}

function cookieOf(res: Response) {
  return res.headers.get("set-cookie") ?? "";
}

describe("first-user admin fallback", () => {
  beforeAll(migrate);

  it("empty OWNER_ADMIN_EMAIL: the first verified user to sign in becomes admin", async () => {
    const saved = env.OWNER_ADMIN_EMAIL;
    env.OWNER_ADMIN_EMAIL = "";
    try {
      await demoteAll();
      const first = `first-${crypto.randomUUID()}@t.dev`;
      await signUp(first);
      const v = await verifyLatest(first); // auto sign-in creates the session
      expect((await roleOf(first))?.role).toBe("admin");

      const dash = await SELF.fetch(DASH, { headers: { cookie: cookieOf(v) } });
      expect(dash.status).toBe(200);
    } finally {
      env.OWNER_ADMIN_EMAIL = saved;
    }
  });

  it("a second verified user stays a plain user and gets dashboard 403", async () => {
    const saved = env.OWNER_ADMIN_EMAIL;
    env.OWNER_ADMIN_EMAIL = "";
    try {
      await demoteAll();
      const first = `f-${crypto.randomUUID()}@t.dev`;
      const second = `s-${crypto.randomUUID()}@t.dev`;
      await signUp(first);
      await verifyLatest(first);
      await signUp(second);
      const v2 = await verifyLatest(second);

      expect((await roleOf(second))?.role).not.toBe("admin");
      const dash = await SELF.fetch(DASH, { headers: { cookie: cookieOf(v2) } });
      expect(dash.status).toBe(403);
    } finally {
      env.OWNER_ADMIN_EMAIL = saved;
    }
  });

  it("OWNER_ADMIN_EMAIL set to a different email disables the fallback", async () => {
    const saved = env.OWNER_ADMIN_EMAIL;
    env.OWNER_ADMIN_EMAIL = "someone-else@x.dev";
    try {
      await demoteAll();
      const email = `nonowner-${crypto.randomUUID()}@t.dev`;
      await signUp(email);
      await verifyLatest(email);
      expect((await roleOf(email))?.role).not.toBe("admin");
    } finally {
      env.OWNER_ADMIN_EMAIL = saved;
    }
  });
});

describe("dynamic sign-up gate", () => {
  beforeAll(migrate);

  it("empty SIGNUP_DISABLED closes sign-ups once an admin exists; sign-in still works", async () => {
    const saved = env.SIGNUP_DISABLED;
    env.SIGNUP_DISABLED = "";
    try {
      // An admin already exists from the earlier suite (or make one).
      const admin = await env.DB.prepare("SELECT 1 FROM user WHERE role = 'admin' LIMIT 1").first();
      if (!admin) {
        await env.DB.prepare(
          "UPDATE user SET role = 'admin' WHERE id = (SELECT id FROM user LIMIT 1)",
        ).run();
      }

      const closedEmail = `closed-${crypto.randomUUID()}@t.dev`;
      const closed = await signUp(closedEmail);
      expect(closed.status).not.toBe(200);
      const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
        .bind(closedEmail)
        .first();
      expect(row).toBeNull();

      const config = await SELF.fetch(CONFIG);
      expect((await config.json<{ signupEnabled: boolean }>()).signupEnabled).toBe(false);

      const anyUser = await env.DB.prepare("SELECT email FROM user LIMIT 1").first<{
        email: string;
      }>();
      const login = await signIn(anyUser!.email);
      expect(login.status).toBe(200);
    } finally {
      env.SIGNUP_DISABLED = saved;
    }
  });

  it("empty SIGNUP_DISABLED reports signupEnabled true while no admin exists", async () => {
    const saved = env.SIGNUP_DISABLED;
    env.SIGNUP_DISABLED = "";
    try {
      await demoteAll();
      const config = await SELF.fetch(CONFIG);
      expect((await config.json<{ signupEnabled: boolean }>()).signupEnabled).toBe(true);
    } finally {
      env.SIGNUP_DISABLED = saved;
    }
  });

  it("SIGNUP_DISABLED=false keeps sign-ups open even with an admin", async () => {
    const saved = env.SIGNUP_DISABLED;
    env.SIGNUP_DISABLED = "false";
    try {
      const admin = await env.DB.prepare("SELECT 1 FROM user WHERE role = 'admin' LIMIT 1").first();
      if (!admin) {
        await env.DB.prepare(
          "UPDATE user SET role = 'admin' WHERE id = (SELECT id FROM user LIMIT 1)",
        ).run();
      }
      const email = `open-${crypto.randomUUID()}@t.dev`;
      const r = await signUp(email);
      expect(r.status).toBe(200);
    } finally {
      env.SIGNUP_DISABLED = saved;
    }
  });
});
