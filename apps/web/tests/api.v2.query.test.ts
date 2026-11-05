import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { handleStatsQuery, v2MethodNotAllowed } from "../worker/routes/v2-query";

// Harness shim: keeps the { request, context } call shape while the Hono
// handler takes (request, env, sessionAnalytics) directly.
async function action(args: {
  request: Request;
  context: {
    cloudflare: { env: Env };
    sessionAnalytics: () => import("../worker/analytics/r2-sql").R2SQLAPI;
  };
}) {
  return handleStatsQuery(args.request, args.context.cloudflare.env, args.context.sessionAnalytics);
}

function loader() {
  return v2MethodNotAllowed();
}

function request(body: unknown, token = "stats-secret") {
  return new Request("https://analytics.example/api/v2/query", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function context(
  overrides: Record<string, unknown> = {},
  site: { domain: string; timezone: string } | null = {
    domain: "example.com",
    timezone: "Etc/UTC",
  },
) {
  const siteStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(
      site && {
        ...site,
        tracker_id: "tracker-1",
        tracker_script_configuration: "{}",
      },
    ),
  };
  const sessions =
    "sessionAnalytics" in overrides
      ? overrides.sessionAnalytics
      : {
          getSessionMetrics: vi.fn().mockResolvedValue({
            views: 0,
            visitors: 0,
            visits: 0,
            bounces: 0,
            events: 0,
            averageVisitDuration: null,
          }),
          getSessionBreakdown: vi.fn().mockResolvedValue({ rows: [] }),
          getBasicMetrics: vi.fn().mockResolvedValue({ rows: [] }),
        };
  delete overrides.sessionAnalytics;
  return {
    sessionAnalytics: () => sessions,
    cloudflare: {
      env: {
        STATS_API_TOKEN: "stats-secret",
        DB: { prepare: vi.fn(() => siteStatement) },
      },
    },
    ...overrides,
  };
}

describe("Plausible Stats API v2", () => {
  afterEach(() => vi.useRealTimers());

  test("rejects GET and invalid API keys", async () => {
    expect(loader().status).toBe(405);
    const response = await action({
      request: request({ site_id: "example.com" }, "wrong"),
      context: context(),
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid API key" });
  });

  test("returns aggregate Basin metrics in Plausible format", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [{ visitors: 12, views: 20, events: 24 }],
    });
    const appContext = context({
      sessionAnalytics: { getBasicMetrics },
    });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors", "pageviews", "events"],
        date_range: "7d",
      }),
      context: appContext,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ dimensions: [], metrics: [12, 20, 24] }],
      meta: {},
      query: {
        site_id: "example.com",
        metrics: ["visitors", "pageviews", "events"],
        date_range: ["2026-07-27T00:00:00+00:00", "2026-08-02T12:00:00+00:00"],
        filters: [],
        dimensions: [],
        order_by: [["visitors", "desc"]],
        include: {},
        pagination: { limit: 10_000, offset: 0 },
      },
    });
    expect(getBasicMetrics).toHaveBeenCalledOnce();
  });

  test("targets the configured Basin table via R2SQLAPI", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [{ visitors: 3 }] },
        }),
      ),
    );
    const { R2SQLAPI } = await import("../worker/analytics/r2-sql");
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher as typeof fetch);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
      }),
      context: context({ sessionAnalytics: api }),
    } as never);

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain("/basin-sql/query/");
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body.query).toContain("FROM noomers.events");
  });

  test("rejects sites outside the registry", async () => {
    const response = await action({
      request: request({
        site_id: "unknown.example",
        metrics: ["visitors"],
        date_range: "day",
      }),
      context: context({}, null),
    } as never);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Site not found" });
  });

  test("uses the site's timezone for day boundaries and buckets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T02:00:00.000Z"));
    const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [] });
    const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [] });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "day",
        dimensions: ["time:day"],
      }),
      context: context(
        { sessionAnalytics: { getSessionBreakdown, getBasicMetrics } },
        { domain: "example.com", timezone: "America/Los_Angeles" },
      ),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { query: { date_range: string[] } };
    expect(body.query.date_range[0]).toBe("2026-08-01T00:00:00-07:00");
  });

  test("uses R2 exclusively when exact session metrics are requested", async () => {
    const getSessionMetrics = vi.fn().mockResolvedValue({
      visitors: 8,
      visits: 10,
      views: 18,
      events: 21,
      bounces: 4,
      averageVisitDuration: 42,
    });
    const appContext = context({ sessionAnalytics: { getSessionMetrics } });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: [
          "visitors",
          "visits",
          "pageviews",
          "views_per_visit",
          "bounce_rate",
          "visit_duration",
          "events",
        ],
        date_range: ["2026-08-01", "2026-08-02"],
      }),
      context: appContext,
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { metrics: unknown[] }[] };
    expect(body.results[0].metrics).toEqual([8, 10, 18, 1.8, 40, 42, 21]);
    expect(getSessionMetrics).toHaveBeenCalledOnce();
  });

  test("uses R2 sessionization for dimension breakdowns", async () => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({
      rows: [
        {
          dimension: "/pricing",
          visitors: 4,
          visits: 5,
          views: 8,
          events: 10,
          bounces: 2,
          averageVisitDuration: 35.5,
        },
      ],
    });
    const appContext = context({ sessionAnalytics: { getSessionBreakdown } });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors", "visits", "pageviews", "bounce_rate"],
        date_range: ["2026-08-01", "2026-08-02"],
        dimensions: ["event:page"],
      }),
      context: appContext,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ dimensions: ["/pricing"], metrics: [4, 5, 8, 40] }],
    });
    expect(getSessionBreakdown).toHaveBeenCalledWith(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-03T00:00:00.000Z"),
      [],
      "event:page",
      undefined,
      expect.objectContaining({
        orderBy: [{ field: "visitors", direction: "desc" }],
        pagination: { limit: 10_000, offset: 0 },
        count: undefined,
      }),
    );
  });

  test("server-side pages and counts R2 session breakdowns", async () => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({
      rows: [
        {
          dimension: "/two",
          visitors: 5,
          visits: 8,
          views: 8,
          events: 9,
          bounces: 1,
          averageVisitDuration: 10,
        },
      ],
      totalRows: 3,
    });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors", "visits"],
        date_range: "24h",
        dimensions: ["event:page"],
        order_by: [["visitors", "desc"]],
        include: { total_rows: true },
        pagination: { limit: 1, offset: 1 },
      }),
      context: context({ sessionAnalytics: { getSessionBreakdown } }),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: unknown[];
      meta: unknown;
    };
    expect(body.results).toEqual([{ dimensions: ["/two"], metrics: [5, 8] }]);
    expect(body.meta).toEqual({ total_rows: 3 });
    expect(getSessionBreakdown).toHaveBeenCalledWith(
      "example.com",
      expect.any(Date),
      expect.any(Date),
      [],
      "event:page",
      undefined,
      expect.objectContaining({
        orderBy: [{ field: "visitors", direction: "desc" }],
        pagination: { limit: 1, offset: 1 },
        count: true,
      }),
    );
  });

  test("supports multi-value filter operators", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [{ dimension: "/pricing", visitors: 5, views: 8, events: 9 }],
    });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        dimensions: ["event:page"],
        filters: [
          ["is_not", "event:hostname", ["internal.example", "preview.example"]],
          ["contains", "event:page", ["pricing", "plans"]],
          ["contains_not", "event:page", ["internal"]],
        ],
      }),
      context: context({ sessionAnalytics: { getBasicMetrics } }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ dimensions: ["/pricing"], metrics: [5] }],
    });
    expect(getBasicMetrics).toHaveBeenCalledWith(
      "example.com",
      expect.any(Date),
      expect.any(Date),
      [
        { operator: "is_not", field: "host", values: ["internal.example", "preview.example"] },
        { operator: "contains", field: "path", values: ["pricing", "plans"] },
        { operator: "contains_not", field: "path", values: ["internal"] },
      ],
      "event:page",
      undefined,
      expect.anything(),
    );
  });

  test("passes DST-aware site-timezone buckets to R2", async () => {
    const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [] });
    const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [] });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visits"],
        date_range: ["2026-03-08", "2026-03-08"],
        dimensions: ["time:day"],
      }),
      context: context(
        { sessionAnalytics: { getSessionBreakdown, getBasicMetrics } },
        { domain: "example.com", timezone: "America/Los_Angeles" },
      ),
    } as never);

    expect(response.status).toBe(200);
    const buckets = getSessionBreakdown.mock.calls[0][5];
    expect(buckets).toEqual([
      {
        label: "2026-03-08",
        start: new Date("2026-03-08T08:00:00.000Z"),
        end: new Date("2026-03-09T07:00:00.000Z"),
      },
    ]);
  });

  test("supports a filtered, ordered, paginated dimension breakdown", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [{ dimension: "/two", visitors: 5, views: 8, events: 9 }],
      totalRows: 2,
    });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors", "pageviews"],
        date_range: "24h",
        dimensions: ["event:page"],
        filters: [["is", "event:hostname", ["example.com"]]],
        order_by: [["visitors", "desc"]],
        include: { total_rows: true },
        pagination: { limit: 1, offset: 0 },
      }),
      context: context({ sessionAnalytics: { getBasicMetrics } }),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[]; meta: unknown };
    expect(body.results).toEqual([{ dimensions: ["/two"], metrics: [5, 8] }]);
    expect(body.meta).toEqual({ total_rows: 2 });
    expect(getBasicMetrics).toHaveBeenCalledWith(
      "example.com",
      expect.any(Date),
      expect.any(Date),
      [{ operator: "is", field: "host", values: ["example.com"] }],
      "event:page",
      undefined,
      expect.objectContaining({
        orderBy: [{ field: "visitors", direction: "desc" }],
        pagination: { limit: 1, offset: 0 },
        count: true,
      }),
    );
  });

  test("returns hourly time series with complete time labels", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [
        { dimension: "2026-08-01 10:00:00", visitors: 1, views: 1, events: 1 },
        { dimension: "2026-08-01 11:00:00", visitors: 2, views: 3, events: 4 },
      ],
    });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors", "pageviews"],
        date_range: ["2026-08-01T10:15:00Z", "2026-08-01T12:05:00Z"],
        dimensions: ["time:hour"],
        include: { time_labels: true },
      }),
      context: context({ sessionAnalytics: { getBasicMetrics } }),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: unknown[];
      meta: { time_labels: string[] };
      query: { order_by: unknown[] };
    };
    expect(body.results).toEqual([
      { dimensions: ["2026-08-01 10:00:00"], metrics: [1, 1] },
      { dimensions: ["2026-08-01 11:00:00"], metrics: [2, 3] },
    ]);
    expect(body.meta.time_labels).toEqual([
      "2026-08-01 10:00:00",
      "2026-08-01 11:00:00",
      "2026-08-01 12:00:00",
    ]);
    expect(body.query.order_by).toEqual([["time:hour", "asc"]]);
    expect(getBasicMetrics).toHaveBeenCalledWith(
      "example.com",
      expect.any(Date),
      expect.any(Date),
      [],
      "time:hour",
      expect.any(Array),
      expect.objectContaining({
        orderBy: [{ field: "dimension", direction: "asc" }],
      }),
    );
  });

  test("resolves automatic time dimensions to weekly buckets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [] });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "91d",
        dimensions: ["time"],
      }),
      context: context({ sessionAnalytics: { getBasicMetrics } }),
    } as never);

    const body = (await response.json()) as {
      query: { dimensions: string[]; order_by: unknown[] };
    };
    expect(body.query.dimensions).toEqual(["time:week"]);
    expect(body.query.order_by).toEqual([["time:week", "asc"]]);
    expect(getBasicMetrics.mock.calls[0][4]).toBe("time:week");
  });

  test("normalizes month-based date presets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "6mo",
      }),
      context: context(),
    } as never);

    const body = (await response.json()) as {
      query: { date_range: string[] };
    };
    expect(body.query.date_range).toEqual([
      "2026-02-01T00:00:00+00:00",
      "2026-08-02T12:00:00+00:00",
    ]);
  });

  test("normalizes exact timestamp boundaries in the reporting timezone", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: ["2026-08-01T10:15:00.250Z", "2026-08-01T12:05:00.750Z"],
      }),
      context: context({}, { domain: "example.com", timezone: "America/Los_Angeles" }),
    } as never);

    const body = (await response.json()) as { query: { date_range: string[] } };
    expect(body.query.date_range).toEqual([
      "2026-08-01T03:15:00.250-07:00",
      "2026-08-01T05:05:00.750-07:00",
    ]);
  });

  test("uses R2 aggregates for basic metrics when available", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [
        {
          visitors: 7,
          views: 11,
          events: 13,
        },
      ],
    });
    const appContext = context({ sessionAnalytics: { getBasicMetrics } });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors", "pageviews", "events"],
        date_range: "7d",
      }),
      context: appContext,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ dimensions: [], metrics: [7, 11, 13] }],
    });
    expect(getBasicMetrics).toHaveBeenCalledOnce();
  });

  test("applies client-side offset to scalar R2 aggregates without a dimension", async () => {
    const getBasicMetrics = vi.fn().mockResolvedValue({
      rows: [{ visitors: 5, views: 8, events: 9 }],
    });
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        order_by: [["visitors", "desc"]],
        pagination: { limit: 1, offset: 1 },
      }),
      context: context({ sessionAnalytics: { getBasicMetrics } }),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
    expect(getBasicMetrics).toHaveBeenCalledWith(
      "example.com",
      expect.any(Date),
      expect.any(Date),
      [],
      undefined,
      undefined,
      expect.objectContaining({
        pagination: { limit: 1, offset: 1 },
      }),
    );
  });

  test("returns no-import metadata and echoes independent pagination", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        include: { imports: true },
        pagination: { limit: 10_000, offset: 25_000 },
      }),
      context: context(),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meta: { imports_included: false },
      query: { pagination: { limit: 10_000, offset: 25_000 } },
    });
  });

  test.each([
    ["root", { unexpected: true }, "Request body contains unknown keys"],
    ["include", { include: { unexpected: true } }, "include contains unknown keys"],
    ["pagination", { pagination: { unexpected: 1 } }, "pagination contains unknown keys"],
    ["metrics", { metrics: ["visitors", "visitors"] }, "metrics must be unique"],
    ["dimensions", { dimensions: ["event:page", "event:page"] }, "dimensions must be unique"],
  ])("rejects invalid %s fields", async (_name, override, error) => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        ...override,
      }),
      context: context(),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
  });

  test("rejects hostname-only breakdowns for session metrics", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visits"],
        date_range: "7d",
        dimensions: ["event:hostname"],
      }),
      context: context({ sessionAnalytics: {} }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "event:hostname requires event:page when querying session metrics",
    });
  });

  test("rejects malformed filters", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        filters: [["matches", "event:page", [".*"]]],
      }),
      context: context(),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "filters contain an unsupported operator, dimension, or value list",
    });
  });

  test("requires R2 SQL for session dimension queries", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["bounce_rate"],
        date_range: "7d",
        dimensions: ["event:page"],
      }),
      context: context({ sessionAnalytics: null }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Basin SQL is not configured",
    });
  });

  test("returns malformed optional values as validation errors", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        pagination: null,
      }),
      context: context(),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "pagination must be an object",
    });
  });

  test("requires boolean include options", async () => {
    const response = await action({
      request: request({
        site_id: "example.com",
        metrics: ["visitors"],
        date_range: "7d",
        include: { total_rows: "false" },
      }),
      context: context(),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "include options must be booleans",
    });
  });
});
