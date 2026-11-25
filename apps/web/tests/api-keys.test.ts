/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { migrate, verifiedSessionCookie } from "./helpers";
import { hashApiKey } from "../worker/api-keys/repository";

const BASE = "https://worker.test/api/dashboard/api-keys";
let cookie = "";

function req(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

async function createKey(
  scope: "stats" | "sites",
  name = `key-${crypto.randomUUID().slice(0, 8)}`,
) {
  const res = await req(BASE, "POST", { name, scope });
  expect(res.status).toBe(201);
  return res.json<{ id: string; key: string; scope: string; name: string }>();
}

beforeAll(async () => {
  await migrate();
  cookie = await verifiedSessionCookie("owner@example.com");
});

describe("/api/dashboard/api-keys", () => {
  test("anonymous → 401 on all routes", async () => {
    expect((await SELF.fetch(BASE)).status).toBe(401);
    expect(
      (
        await SELF.fetch(BASE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect((await SELF.fetch(`${BASE}/some-id`, { method: "DELETE" })).status).toBe(401);
  });

  test("non-admin → 403 on all routes", async () => {
    const other = await verifiedSessionCookie(`u-${crypto.randomUUID()}@t.dev`);
    const as = (path: string, method: string, body?: unknown) =>
      SELF.fetch(path, {
        method,
        headers: {
          Cookie: other,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    expect((await as(BASE, "GET")).status).toBe(403);
    expect((await as(BASE, "POST", { name: "x", scope: "stats" })).status).toBe(403);
    expect((await as(`${BASE}/some-id`, "DELETE")).status).toBe(403);
  });

  test("validation → 400", async () => {
    expect((await req(BASE, "POST", { name: "x", scope: "stats", nope: true })).status).toBe(400);
    expect((await req(BASE, "POST", { name: "", scope: "stats" })).status).toBe(400);
    expect((await req(BASE, "POST", { name: "a".repeat(65), scope: "stats" })).status).toBe(400);
    expect((await req(BASE, "POST", { name: "x", scope: "bogus" })).status).toBe(400);
    expect((await req(BASE, "POST", "not json{")).status).toBe(400);
  });

  test("create → 201 returns the plaintext key once; list never leaks it", async () => {
    const created = await createKey("stats");
    expect(created.key).toMatch(/^nmr_[A-Za-z0-9_-]{43}$/);
    expect(created.name).toBeTruthy();

    const list = await req(BASE, "GET");
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(created.key);
    expect(text).not.toContain(await hashApiKey(created.key));
    expect(text).not.toContain("key_hash");
    const body = JSON.parse(text) as {
      api_keys: { id: string; prefix: string; last_used_at: number | null }[];
    };
    const row = body.api_keys.find((k) => k.id === created.id);
    expect(row?.prefix).toBe(created.key.slice(0, 12));
    expect(row?.last_used_at).toBeNull();
  });

  test("revoke → 200, idempotent, unknown → 404", async () => {
    const created = await createKey("stats");
    const res = await req(`${BASE}/${created.id}`, "DELETE");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revoked: true });

    const again = await req(`${BASE}/${created.id}`, "DELETE");
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toEqual({ revoked: true });

    expect((await req(`${BASE}/${crypto.randomUUID()}`, "DELETE")).status).toBe(404);
  });
});

describe("API key authentication", () => {
  const statsQuery = (token: string) =>
    SELF.fetch("https://worker.test/api/v1/query", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
  const v1Sites = (token: string) =>
    SELF.fetch("https://worker.test/api/v1/sites", {
      headers: { Authorization: `Bearer ${token}` },
    });

  test("stats scope authorizes /api/v1/query but not /api/v1/sites", async () => {
    const { key } = await createKey("stats", "stats-only");
    expect((await statsQuery(key)).status).not.toBe(401);
    expect((await v1Sites(key)).status).toBe(401);
  });

  test("sites scope authorizes both APIs", async () => {
    const { key } = await createKey("sites", "sites-key");
    expect((await v1Sites(key)).status).toBe(200);
    expect((await statsQuery(key)).status).not.toBe(401);
  });

  test("revoked and unknown nmr_ keys → 401", async () => {
    const { id, key } = await createKey("sites", "revoked-key");
    await req(`${BASE}/${id}`, "DELETE");
    expect((await v1Sites(key)).status).toBe(401);
    expect((await statsQuery(key)).status).toBe(401);
    expect((await v1Sites("nmr_doesnotexist")).status).toBe(401);
  });

  test("last_used_at is recorded after a successful call", async () => {
    const { id, key } = await createKey("stats", "last-used");
    await statsQuery(key);
    const row = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
      .bind(id)
      .first<{ last_used_at: number | null }>();
    expect(row?.last_used_at).toEqual(expect.any(Number));
  });

  test("env tokens: stats-secret works on sites and query; sites-secret only on sites", async () => {
    expect((await v1Sites("stats-secret")).status).toBe(200);
    expect((await statsQuery("stats-secret")).status).not.toBe(401);
    expect((await v1Sites("sites-secret")).status).toBe(200);
    expect((await statsQuery("sites-secret")).status).toBe(401);
  });

  test("the old /api/v2/query path is gone → 404", async () => {
    const res = await SELF.fetch("https://worker.test/api/v2/query", {
      method: "POST",
      headers: { Authorization: "Bearer stats-secret", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
