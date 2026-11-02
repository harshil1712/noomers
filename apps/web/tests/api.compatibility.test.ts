/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { migrate, seedSite } from "./helpers";

describe("Plausible compatibility routes", () => {
  beforeAll(async () => {
    await migrate();
    await seedSite("example.com");
  });

  test("exposes the health endpoint", async () => {
    const response = await SELF.fetch("https://x/api/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("rejects GET requests to the event endpoint", async () => {
    const response = await SELF.fetch("https://x/api/event");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  test("routes official tracker payloads into analytics", async () => {
    const response = await SELF.fetch("https://analytics.example/api/event", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        n: "pageview",
        v: 34,
        u: "https://example.com/",
        d: "example.com",
        r: null,
      }),
    });

    expect(response.status).toBe(202);
    // the durable buffer actually recorded the event
    const ns = env.SITE_EVENTS!;
    const backlog = await ns.get(ns.idFromName("example.com")).backlog();
    expect(backlog.unshipped).toBeGreaterThan(0);
  });
});
