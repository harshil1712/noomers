/* eslint-disable import/no-unresolved */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vite-plus/test";
import type { SiteEvents } from "../worker/site-events";

const ns = env.SITE_EVENTS as unknown as DurableObjectNamespace<SiteEvents>;

function stub() {
  return ns.get(ns.idFromName(`site-${crypto.randomUUID()}`));
}

function event(over: Record<string, unknown> = {}) {
  return {
    event_id: crypto.randomUUID(),
    received_at: new Date().toISOString(),
    site_id: "s",
    visitor_id: "v1",
    event_type: "pageview",
    event_name: "pageview",
    pathname: "/a",
    referrer: "",
    hostname: "e2e.test",
    event_properties: "",
    browser: "Chrome",
    browser_version: "1",
    operating_system: "macOS",
    operating_system_version: "14",
    device_type: "desktop",
    device_model: "",
    country: "US",
    region: "CA",
    city: "SF",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    utm_content: "",
    interactive: true,
    engagement_time: 0,
    scroll_depth: 0,
    revenue_amount: "",
    revenue_currency: "",
    ...over,
  } as unknown as Parameters<SiteEvents["record"]>[0];
}

type DO = {
  ctx: DurableObjectState;
  env: { EVENT_STREAM?: { send: (rows: unknown[]) => Promise<unknown> | unknown } };
};

async function run<T>(
  s: ReturnType<typeof stub>,
  fn: (instance: SiteEvents & DO, ctx: DurableObjectState) => Promise<T> | T,
): Promise<T> {
  let out!: T;
  await runInDurableObject(s as unknown as DurableObjectStub, async (instance, ctx) => {
    out = await fn(instance as unknown as SiteEvents & DO, ctx);
  });
  return out;
}

function setStream(instance: SiteEvents & DO, behavior: "ok" | "fail" | "capture") {
  instance.env.EVENT_STREAM = {
    send: async (rows) => {
      if (behavior === "fail") throw new Error("send failed");
      // store shipped rows count in DO storage for assertions
      (
        instance.ctx.storage.sql as {
          exec: (q: string, ...a: unknown[]) => { rowsWritten: number };
        }
      ).exec(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('captured', ?)",
        String(rows.length),
      );
    },
  };
}

describe("SiteEvents", () => {
  it("record() then alarm ships one batch to EVENT_STREAM", async () => {
    const s = stub();
    await s.record(event());
    await run(s, (instance) => setStream(instance, "capture"));
    await runDurableObjectAlarm(s as unknown as DurableObjectStub);
    const shipped = await run(s, async (instance) => {
      const captured = instance.ctx.storage.sql
        .exec("SELECT value FROM meta WHERE key='captured'")
        .toArray() as { value: string }[];
      const shippedSeq = instance.ctx.storage.sql
        .exec("SELECT value FROM meta WHERE key='shipped_seq'")
        .toArray() as { value: string }[];
      return { captured, shippedSeq };
    });
    expect(Number(shipped.captured[0].value)).toBe(1);
    expect(shipped.shippedSeq.length).toBe(1);
  });

  it("send failure keeps rows, increments backoff, later success resets", async () => {
    const s = stub();
    await s.record(event());
    await run(s, (instance) => setStream(instance, "fail"));
    await runDurableObjectAlarm(s as unknown as DurableObjectStub);
    const state = await run(s, async (instance) => ({
      rows: instance.ctx.storage.sql.exec("SELECT seq FROM events").toArray().length,
      shipped: instance.ctx.storage.sql
        .exec("SELECT value FROM meta WHERE key='shipped_seq'")
        .toArray().length,
      failures: (
        instance.ctx.storage.sql
          .exec("SELECT value FROM meta WHERE key='send_failures'")
          .toArray() as { value: string }[]
      )[0]?.value,
      alarm: await instance.ctx.storage.getAlarm(),
    }));
    expect(state.rows).toBe(1);
    expect(state.shipped).toBe(0);
    expect(Number(state.failures)).toBe(1);
    expect(state.alarm).not.toBeNull();

    await run(s, (instance) => setStream(instance, "capture"));
    await runDurableObjectAlarm(s as unknown as DurableObjectStub);
    const state2 = await run(s, async (instance) => ({
      shipped: instance.ctx.storage.sql
        .exec("SELECT value FROM meta WHERE key='shipped_seq'")
        .toArray().length,
      failures: (
        instance.ctx.storage.sql
          .exec("SELECT value FROM meta WHERE key='send_failures'")
          .toArray() as { value: string }[]
      )[0]?.value,
    }));
    expect(state2.shipped).toBe(1);
    expect(Number(state2.failures)).toBe(0);
  });

  it("prune never deletes unshipped rows", async () => {
    const s = stub();
    await s.record(event({ received_at: new Date(Date.now() - 2 * 3600e3).toISOString() }));
    await run(s, (instance) => setStream(instance, "fail"));
    await runDurableObjectAlarm(s as unknown as DurableObjectStub);
    const rows = await run(
      s,
      (instance) => instance.ctx.storage.sql.exec("SELECT seq FROM events").toArray().length,
    );
    expect(rows).toBe(1);
  });

  it("seq keeps increasing after a full prune", async () => {
    const s = stub();
    await s.record(event({ received_at: new Date(Date.now() - 2 * 3600e3).toISOString() }));
    await s.record(event({ received_at: new Date(Date.now() - 2 * 3600e3).toISOString() }));
    await run(s, (instance) => setStream(instance, "ok"));
    await runDurableObjectAlarm(s as unknown as DurableObjectStub);
    const after = await run(
      s,
      (instance) => instance.ctx.storage.sql.exec("SELECT seq FROM events").toArray().length,
    );
    expect(after).toBe(0); // shipped + past retention -> pruned
    await s.record(event());
    const lastSeq = await run(s, (instance) => {
      const row = instance.ctx.storage.sql
        .exec("SELECT seq FROM events ORDER BY seq DESC LIMIT 1")
        .toArray()[0] as { seq: number };
      return row.seq;
    });
    expect(lastSeq).toBeGreaterThan(2);
  });

  it("realtime() aggregates last-30m data", async () => {
    const s = stub();
    await s.record(event({ visitor_id: "v1", pathname: "/a", referrer: "https://x.com/r" }));
    await s.record(event({ visitor_id: "v2", pathname: "/b" }));
    await s.record(event({ visitor_id: "v1", event_type: "engagement", engagement_time: 1000 }));
    const rt = await s.realtime();
    expect(rt.currentVisitors).toBe(2);
    expect(rt.pageviews30m).toBe(2);
    expect(rt.pageviewsPerMinute).toHaveLength(30);
    expect(rt.pageviewsPerMinute[29]).toBe(2);
    expect(rt.topPages[0]).toEqual({ pathname: "/a", views: 1 });
    expect(rt.topReferrers[0]).toEqual({ referrer: "x.com", views: 1 });
  });

  it("purge() clears everything and disarms the alarm", async () => {
    const s = stub();
    await s.record(event());
    await s.purge();
    const alarm = await run(s, async (instance) => instance.ctx.storage.getAlarm());
    expect(alarm).toBeNull();
  });

  it("no alarm armed when nothing to do", async () => {
    const s = stub();
    await run(s, (instance) => setStream(instance, "ok"));
    await runDurableObjectAlarm(s as unknown as DurableObjectStub);
    const alarm = await run(s, async (instance) => instance.ctx.storage.getAlarm());
    expect(alarm).toBeNull();
  });
});

describe("realtime route guard", () => {
  const rtUrl = "https://worker.test/realtime/mysite";

  it("rejects cross-site Origin (403)", async () => {
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch(rtUrl, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated same-origin request (401)", async () => {
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch(rtUrl, {
      headers: { Origin: "https://worker.test" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown site after auth", async () => {
    const { SELF } = await import("cloudflare:test");
    const { migrate, verifiedSessionCookie } = await import("./helpers");
    await migrate();
    const cookie = await verifiedSessionCookie(`rt-${crypto.randomUUID()}@t.dev`);
    const res = await SELF.fetch(rtUrl, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  it("forwards an authed same-origin upgrade to the DO (101)", async () => {
    const { SELF } = await import("cloudflare:test");
    const { migrate, seedSite, verifiedSessionCookie } = await import("./helpers");
    await migrate();
    await seedSite("mysite");
    const cookie = await verifiedSessionCookie(`rt2-${crypto.randomUUID()}@t.dev`);
    const res = await SELF.fetch(rtUrl, {
      headers: {
        Cookie: cookie,
        Upgrade: "websocket",
        Origin: "https://worker.test",
      },
    });
    expect(res.status).toBe(101);
    // snapshot arrives immediately
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
  });
});
