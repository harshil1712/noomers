/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { migrate, seedSite } from "./helpers";

function request(script: string, host = "pa.example.com") {
  return SELF.fetch(`https://${host}/js/${script}`);
}

describe("/js/:script route", () => {
  beforeAll(async () => {
    await migrate();
    await seedSite("example.com", { plausibleScriptId: "pa-AbCdEfGhIjKl" });
  });

  test("serves the tracker for a known script id", async () => {
    const res = await request("pa-AbCdEfGhIjKl.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = await res.text();
    expect(body).toContain("example.com");
    expect(body).toContain("https://pa.example.com/api/event");
  });

  test("404s for unknown script ids", async () => {
    const res = await request("pa-UnknownScriptId.js");
    expect(res.status).toBe(404);
  });

  test("404s for non-matching script names", async () => {
    const res = await request("tracker.js");
    expect(res.status).toBe(404);
  });
});
