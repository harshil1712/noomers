/// <reference types="@cloudflare/vitest-plugin/types" />
import { describe, expect, test, vi } from "vite-plus/test";
import {
  browser,
  browserVersion,
  country,
  device,
  entryPages,
  exitPages,
  events,
  goals,
  mutateGoal,
  paths,
  props,
  referrer,
  stats,
  timeseries,
  utmCampaign,
  utmContent,
  utmMedium,
  utmSource,
  utmTerm,
} from "../worker/routes/dashboard";
import type { R2SQLAPI } from "../worker/analytics/r2-sql";
import { migrate, seedGoal, seedSite } from "./helpers";

/** Stub analytics accessor — handlers take it as an injected seam. */
function ctx(analytics: Partial<R2SQLAPI>) {
  return {
    env: { DB: undefined } as unknown as Env,
    sessionAnalytics: () => analytics as R2SQLAPI,
  };
}

const url = (path: string) => new Request(`http://x/api/dashboard/${path}`);

describe("dashboard handlers (ported loader tests)", () => {
  test("paths → event:page, views, desc, paginated", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [
        { dimension: "/example", visitors: 4, views: 10, events: 10 },
        { dimension: "/", visitors: 2, views: 7, events: 7 },
      ],
    });
    const res = await paths(ctx({ getBasicMetrics }), url("paths?site=example.com&interval=7d"));
    expect(getBasicMetrics).toHaveBeenCalledWith(
      "example.com",
      expect.any(Date),
      expect.any(Date),
      {},
      "event:page",
      undefined,
      expect.objectContaining({
        orderBy: [{ field: "pageviews", direction: "desc" }],
        pagination: { limit: 10, offset: 0 },
      }),
    );
    expect(await res.json()).toEqual({
      countsByProperty: [
        ["/example", 4, 10],
        ["/", 2, 7],
      ],
      page: 1,
    });
  });

  test("referrer → visit:referrer via session breakdown", async () => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({
      rows: [{ dimension: "google.com", visitors: 3, visits: 3, views: 9, events: 9 }],
    });
    const res = await referrer(ctx({ getSessionBreakdown }), url("referrer?site=x&page=2"));
    expect(getSessionBreakdown).toHaveBeenCalledWith(
      "x",
      expect.any(Date),
      expect.any(Date),
      {},
      "visit:referrer",
      undefined,
      expect.objectContaining({ pagination: { limit: 10, offset: 10 } }),
    );
    expect(await res.json()).toEqual({ countsByProperty: [["google.com", 3, 3]], page: 2 });
  });

  test("events drops pageview/engagement rows", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [
        { dimension: "pageview", visitors: 9, views: 9, events: 9 },
        { dimension: "signup", visitors: 1, views: 1, events: 2 },
        { dimension: "engagement", visitors: 1, views: 1, events: 1 },
      ],
    });
    const res = await events(ctx({ getBasicMetrics }), url("events?site=x"));
    expect(await res.json()).toEqual({ countsByProperty: [["signup", 2]], page: 1 });
  });

  test.each([
    ["entry-pages", entryPages, "visit:entry_page"],
    ["exit-pages", exitPages, "visit:exit_page"],
    ["browser", browser, "visit:browser"],
    ["browserversion", browserVersion, "visit:browser_version"],
    ["device", device, "visit:device_type"],
    ["utm-source", utmSource, "visit:utm_source"],
    ["utm-medium", utmMedium, "visit:utm_medium"],
    ["utm-campaign", utmCampaign, "visit:utm_campaign"],
    ["utm-term", utmTerm, "visit:utm_term"],
    ["utm-content", utmContent, "visit:utm_content"],
  ] as const)("%s → %s via session breakdown", async (name, handler, dimension) => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [] });
    await handler(ctx({ getSessionBreakdown }), url(`${name}?site=x`));
    expect(getSessionBreakdown).toHaveBeenCalledWith(
      "x",
      expect.any(Date),
      expect.any(Date),
      {},
      dimension,
      undefined,
      expect.objectContaining({ orderBy: [{ field: "visits", direction: "desc" }] }),
    );
  });

  test("country maps codes to display names", async () => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({
      rows: [{ dimension: "US", visitors: 1, visits: 1, views: 2, events: 2 }],
    });
    const res = await country(ctx({ getSessionBreakdown }), url("country?site=x"));
    expect(await res.json()).toEqual({
      countsByProperty: [[["US", "United States"], 1, 1]],
      page: 1,
    });
  });

  test("props requires event and key", async () => {
    const res = await props(ctx({}), url("props?site=x&key=url"));
    expect(res.status).toBe(400);
  });

  test("props queries event:props:<key> with name filter", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [] });
    const res = await props(ctx({ getBasicMetrics }), url("props?site=x&event=outbound&key=url"));
    expect(res.status).toBe(200);
    expect(getBasicMetrics).toHaveBeenCalledWith(
      "x",
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({ name: "outbound" }),
      "event:props:url",
      undefined,
      expect.anything(),
    );
  });

  test("stats returns metrics plus the previous period", async () => {
    const getSessionMetrics = vi
      .fn()
      .mockResolvedValueOnce({
        views: 10,
        visitors: 5,
        visits: 4,
        bounces: 2,
        averageVisitDuration: 42,
      })
      .mockResolvedValueOnce({
        views: 8,
        visitors: 4,
        visits: 3,
        bounces: 1,
        averageVisitDuration: 30,
      });
    const res = await stats(ctx({ getSessionMetrics }), url("stats?site=x&interval=7d"));
    const body = await res.json();
    expect(body.visitors).toBe(5);
    expect(body.previous).toEqual({
      views: 8,
      visitors: 4,
      visits: 3,
      bounceRate: 1 / 3,
      averageVisitDuration: 30,
      hasSufficientBounceData: true,
    });
  });

  test("stats queries the preceding equal-length window with the same filters", async () => {
    const getSessionMetrics = vi.fn().mockResolvedValue({
      views: 0,
      visitors: 0,
      visits: 0,
      bounces: 0,
      averageVisitDuration: null,
    });
    await stats(
      ctx({ getSessionMetrics }),
      url("stats?site=x&interval=7d&timezone=UTC&referrer=google.com"),
    );
    expect(getSessionMetrics).toHaveBeenCalledTimes(2);
    const [, start1, end1, filters1] = getSessionMetrics.mock.calls[0];
    const [, start2, end2, filters2] = getSessionMetrics.mock.calls[1];
    const span = end1.getTime() - start1.getTime();
    // previous = [start - span, start), half-open
    expect(end2.getTime()).toBe(start1.getTime());
    expect(start1.getTime() - start2.getTime()).toBe(span);
    expect(filters2).toEqual(filters1);
    expect(filters2).toMatchObject({ referrer: "google.com" });
  });

  test("timeseries picks hour/day buckets by interval", async () => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({
      rows: [{ dimension: "2024-01-01", visitors: 1, visits: 1, views: 2, events: 2, bounces: 0 }],
    });
    const res = await timeseries(
      ctx({ getSessionBreakdown }),
      url("timeseries?site=x&interval=7d"),
    );
    expect(getSessionBreakdown).toHaveBeenCalledWith(
      "x",
      expect.any(Date),
      expect.any(Date),
      {},
      "time:day",
      undefined,
      expect.objectContaining({ orderBy: [{ field: "dimension", direction: "asc" }] }),
    );
    const body = await res.json<{ intervalType: string; chartData: unknown[] }>();
    expect(body.intervalType).toBe("DAY");
    expect(body.chartData).toHaveLength(1);
  });

  test("goals returns goals with conversions", async () => {
    await migrate();
    const domain = `g${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    await seedGoal(domain, { name: "signup", type: "event", value: "signup" });
    const getSessionMetrics = vi.fn().mockResolvedValue({ visitors: 10 });
    const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [{ events: 4 }] });
    const res = await goals(
      {
        env: { DB: (await import("cloudflare:test")).env.DB } as unknown as Env,
        sessionAnalytics: () => ({ getSessionMetrics, getBasicMetrics }) as unknown as R2SQLAPI,
      },
      url(`goals?site=${domain}&interval=7d`),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      goals: { name: string; conversions: number; conversionRate: number }[];
    }>();
    expect(body.goals[0].name).toBe("signup");
    expect(body.goals[0].conversions).toBe(4);
    expect(body.goals[0].conversionRate).toBe(40);
  });

  test("mutateGoal create/delete round trip", async () => {
    await migrate();
    const domain = `g${crypto.randomUUID().slice(0, 8)}.dev`;
    await seedSite(domain);
    const env = { DB: (await import("cloudflare:test")).env.DB } as unknown as Env;
    const form = new FormData();
    form.set("site", domain);
    form.set("intent", "create");
    form.set("name", "purchase");
    form.set("type", "event");
    form.set("value", "purchase");
    const res = await mutateGoal(
      { env, sessionAnalytics: () => ({}) as unknown as R2SQLAPI },
      new Request("http://x/api/dashboard/goals", { method: "POST", body: form }),
    );
    expect(res.status).toBe(200);
    const getSessionMetrics = vi.fn().mockResolvedValue({ visitors: 0 });
    const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [] });
    const list = await goals(
      {
        env,
        sessionAnalytics: () => ({ getSessionMetrics, getBasicMetrics }) as unknown as R2SQLAPI,
      },
      url(`goals?site=${domain}&interval=7d`),
    );
    const body = await list.json<{ goals: { name: string }[] }>();
    expect(body.goals.map((g) => g.name)).toContain("purchase");
  });
});
