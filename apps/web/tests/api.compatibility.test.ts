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

  test("routes /collect pageviews into analytics", async () => {
    const response = await SELF.fetch(
      "https://analytics.example/collect?sid=example.com&p=/&h=example.com&r=&ht=1",
      {
        headers: {
          "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          origin: "https://example.com",
        },
      },
    );

    expect(response.status).toBe(200);
    // the durable buffer actually recorded the event for realtime
    const ns = env.SITE_EVENTS!;
    const rt = await ns.get(ns.idFromName("example.com")).realtime();
    expect(rt.pageviews30m).toBeGreaterThan(0);
  });
});
