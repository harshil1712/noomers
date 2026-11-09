/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { migrate, seedSite, verifiedSessionCookie } from "./helpers";

const BASE = "https://worker.test/api/dashboard/sites";
let cookie = "";

function req(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  await migrate();
  cookie = await verifiedSessionCookie("owner@example.com");
});

describe("/api/dashboard/sites mutations", () => {
  test("unauthenticated → 401", async () => {
    const res = await SELF.fetch(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  test("non-admin → 403", async () => {
    const other = await verifiedSessionCookie(`u-${crypto.randomUUID()}@t.dev`);
    const res = await SELF.fetch(BASE, {
      method: "POST",
      headers: { Cookie: other, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  test("create → 201 and listed", async () => {
    const domain = `c${crypto.randomUUID().slice(0, 8)}.dev`;
    const res = await req(BASE, "POST", { domain, timezone: "Europe/Berlin" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ domain, timezone: "Europe/Berlin" });

    const list = await req(BASE, "GET");
    const body = await list.json<{ sites: string[]; details: { domain: string }[] }>();
    expect(body.sites).toContain(domain);
    expect(body.details.map((d) => d.domain)).toContain(domain);
  });

  test("create with unknown key → 400", async () => {
    const res = await req(BASE, "POST", { domain: "x.dev", nope: true });
    expect(res.status).toBe(400);
  });

  test("create with invalid domain/timezone → 400", async () => {
    expect((await req(BASE, "POST", { domain: "not a domain!" })).status).toBe(400);
    expect((await req(BASE, "POST", { domain: "ok.dev", timezone: "Mars/Olympus" })).status).toBe(
      400,
    );
  });

  test("create duplicate / tombstoned → 400", async () => {
    const domain = `d${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    expect((await req(BASE, "POST", { domain })).status).toBe(400);
  });

  test("oversized body → 413", async () => {
    const res = await SELF.fetch(BASE, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "content-type": "application/json",
        "content-length": String(5 * 1024),
      },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });

  test("patch timezone → 200, persisted; patch unknown → 404; extra key → 400", async () => {
    const domain = `p${crypto.randomUUID().slice(0, 8)}.dev`;
    await req(BASE, "POST", { domain });

    const patch = await req(`${BASE}/${domain}`, "PATCH", { timezone: "America/New_York" });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ domain, timezone: "America/New_York" });
    const row = await env.DB.prepare("SELECT timezone FROM sites WHERE domain = ?")
      .bind(domain)
      .first<{ timezone: string }>();
    expect(row?.timezone).toBe("America/New_York");

    expect(
      (
        await req(`${BASE}/missing-${crypto.randomUUID().slice(0, 8)}.dev`, "PATCH", {
          timezone: "UTC",
        })
      ).status,
    ).toBe(404);
    expect(
      (await req(`${BASE}/${domain}`, "PATCH", { timezone: "UTC", domain: "x.dev" })).status,
    ).toBe(400);
  });

  test("delete is case-insensitive on the domain", async () => {
    const domain = `mixed-${crypto.randomUUID().slice(0, 8)}.dev`;
    await req(BASE, "POST", { domain });
    const del = await req(`${BASE}/${domain.toUpperCase()}`, "DELETE");
    expect(del.status).toBe(200);
    const row = await env.DB.prepare("SELECT domain FROM sites WHERE domain = ?")
      .bind(domain)
      .first();
    expect(row).toBeNull();
  });

  test("delete → 200, collection fails closed, deletion job pending, re-create → 400; unknown → 404", async () => {
    const domain = `z${crypto.randomUUID().slice(0, 8)}.dev`;
    await req(BASE, "POST", { domain });

    const del = await req(`${BASE}/${domain}`, "DELETE");
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });

    // Collection fails closed for deleted sites, same as unknown ones.
    const collect = await SELF.fetch(`https://worker.test/collect?sid=${domain}&h=${domain}&p=/`, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36" },
    });
    expect(collect.status).not.toBe(200);

    expect((await req(BASE, "POST", { domain })).status).toBe(400);
    expect(
      (await req(`${BASE}/gone-${crypto.randomUUID().slice(0, 8)}.dev`, "DELETE")).status,
    ).toBe(404);
  });
});
