import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { R2SQLAPI } from "../r2-sql";

// workerd provides a real `caches.default` that persists across tests and
// would poison fetcher call expectations; remove it for this suite.
beforeEach(() => {
  Object.defineProperty(globalThis, "caches", { value: {}, writable: true, configurable: true });
});

describe("R2SQLAPI", () => {
  test("builds a 30-minute session query and maps summary metrics", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [
              {
                views: "12",
                events: "16",
                visitors: 5,
                visits: "7",
                bounces: "2",
                average_visit_duration: "64.5",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const api = new R2SQLAPI(
      "account/id",
      "events bucket",
      "secret-token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    const metrics = await api.getSessionMetrics(
      "example\\'s site",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-01T12:00:00.000Z"),
      { path: "/pricing" },
    );

    expect(metrics).toEqual({
      views: 12,
      events: 16,
      visitors: 5,
      visits: 7,
      bounces: 2,
      averageVisitDuration: 64.5,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.sql.cloudflarestorage.com/api/v1/accounts/account%2Fid/basin-sql/query/events%20bucket",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
      }),
    );
    const request = fetcher.mock.calls[0][1] as RequestInit;
    const requestBody = JSON.parse(String(request.body));
    expect(requestBody.warehouse).toBe("account/id_events bucket");
    const query = requestBody.query as string;
    expect(query).toContain("FROM analytics.events");
    expect(query).toContain("site_id = 'example\\\\''s site'");
    expect(query).toContain("received_at >= '2026-08-01T00:00:00.000Z'");
    expect(query).toContain("CASE WHEN pathname = '/pricing'");
    expect(query).toContain("THEN 1 ELSE 0 END AS matches_filter");
    expect(query).toContain("received_at < '2026-08-02T00:00:00.000Z'");
    expect(query).toContain("LAG(event_ts) OVER");
    expect(query).toContain(">= 1800");
    expect(query).toContain("interactive_events <= 1");
    expect(query).toContain("pageviews > 0");
    expect(query).toContain("matching_events > 0");
  });

  test("calls the injected fetcher with the global receiver, not the R2SQLAPI instance", async () => {
    const fetcher = vi.fn(function (_url: string | Request | URL, _init?: RequestInit) {
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, result: { rows: [] } }), { status: 200 }),
      );
    });
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.query("SELECT 1");

    expect(fetcher.mock.contexts[0]).not.toBeInstanceOf(R2SQLAPI);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.sql.cloudflarestorage.com/api/v1/accounts/account/basin-sql/query/bucket",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    const request = fetcher.mock.calls[0][1] as RequestInit;
    const requestBody = JSON.parse(String(request.body));
    expect(requestBody).toEqual({
      warehouse: "account_bucket",
      query: "SELECT 1",
    });
  });

  test("returns zeroes when the query has no rows", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: { rows: [] } }), { status: 200 }),
      );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(
      api.getSessionMetrics(
        "example.com",
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      views: 0,
      events: 0,
      visitors: 0,
      visits: 0,
      bounces: 0,
      averageVisitDuration: null,
    });
  });

  test("builds session-aware dimension breakdowns", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [
              {
                dimension: "/pricing",
                views: "8",
                events: "10",
                visitors: "4",
                visits: "5",
                bounces: "2",
                average_visit_duration: "35.5",
              },
            ],
          },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(
      api.getSessionBreakdown(
        "example.com",
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-02T00:00:00.000Z"),
        { host: "example.com" },
        "event:page",
      ),
    ).resolves.toEqual({
      rows: [
        {
          dimension: "/pricing",
          views: 8,
          events: 10,
          visitors: 4,
          visits: 5,
          bounces: 2,
          averageVisitDuration: 35.5,
        },
      ],
    });

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("hostname = 'example.com'");
    expect(query).toContain("pathname AS dimension");
    expect(query).toContain(
      "FIRST_VALUE(dimension_value ORDER BY event_ts, event_id) FILTER (WHERE event_type = 'pageview') AS entry_page",
    );
    expect(query).not.toContain("MIN_BY");
    expect(query).toContain("SELECT visitor_id, session_number, entry_page AS dimension");
    expect(query).toContain("sessions.interactive_events <= 1");
    expect(query).toContain("LEFT JOIN session_metrics");
    expect(query).toContain("LIMIT 10001");
  });

  test("builds lightweight aggregate queries for basic metrics", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [{ dimension: "/pricing", visitors: "4", views: "8", events: "10" }],
          },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(
      api.getBasicMetrics(
        "example.com",
        new Date("2026-08-01T10:15:00.250Z"),
        new Date("2026-08-01T12:05:00.750Z"),
        { host: "example.com" },
        "event:page",
      ),
    ).resolves.toEqual({
      rows: [
        {
          dimension: "/pricing",
          visitors: 4,
          views: 8,
          events: 10,
        },
      ],
    });

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("received_at >= '2026-08-01T10:15:00.250Z'");
    expect(query).toContain("received_at < '2026-08-01T12:05:00.750Z'");
    expect(query).toContain("hostname = 'example.com'");
    expect(query).toContain("pathname AS dimension");
    expect(query).toContain("event_type <> 'engagement'");
  });

  test("renders Stats API filter operators", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      [
        { field: "host", operator: "is_not", values: ["internal.example", "preview.example"] },
        { field: "path", operator: "contains", values: ["pricing", "plans"] },
        { field: "path", operator: "contains_not", values: ["internal"] },
      ],
      "event:page",
    );

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("pathname AS dimension");
    expect(query).toContain("hostname NOT IN ('internal.example', 'preview.example')");
    expect(query).toContain("strpos(pathname, 'pricing') > 0 OR strpos(pathname, 'plans') > 0");
    expect(query).toContain("strpos(pathname, 'internal') = 0");
  });

  test("uses visit start for session time buckets", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "time:hour",
    );
    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("date_trunc('hour', event_ts) AS dimension");
    expect(query).toContain("date_trunc('hour', visit_start) AS dimension");
  });

  test("uses explicit UTC boundaries for reporting-timezone buckets", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-03-08T08:00:00.000Z"),
      new Date("2026-03-09T07:00:00.000Z"),
      {},
      "time:day",
      [
        {
          label: "2026-03-08",
          start: new Date("2026-03-08T08:00:00.000Z"),
          end: new Date("2026-03-09T07:00:00.000Z"),
        },
      ],
    );
    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("WHEN event_ts >= TRY_CAST('2026-03-08T08:00:00.000Z' AS TIMESTAMP)");
    expect(query).toContain("event_ts < TRY_CAST('2026-03-09T07:00:00.000Z' AS TIMESTAMP)");
    expect(query).toContain("THEN '2026-03-08'");
    expect(query).toContain("WHEN visit_start >= TRY_CAST");
  });

  test("renders server-side bounded pagination and count for basic metrics", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [{ dimension: "/two", visitors: "5", views: "8", events: "9", total_rows: "3" }],
          },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    const result = await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      {
        orderBy: [{ field: "visitors", direction: "desc" }],
        pagination: { limit: 1, offset: 1 },
        count: true,
      },
    );

    expect(result).toEqual({
      rows: [{ dimension: "/two", visitors: 5, views: 8, events: 9 }],
      totalRows: 3,
    });
    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("ROW_NUMBER() OVER (ORDER BY visitors DESC, dimension ASC) AS row_num");
    expect(query).toContain("COUNT(*) OVER () AS total_rows");
    expect(query).toContain("WHERE row_num > 1");
    expect(query).toContain("AND row_num <= 2");
    expect(query).toContain("SELECT dimension, visitors, views, events, total_rows");
    expect(query).not.toContain("LIMIT 10001");
  });

  test("renders server-side pagination with derived session metric ordering", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [
              {
                dimension: "/pricing",
                views: "8",
                events: "10",
                visitors: "4",
                visits: "5",
                bounces: "2",
                average_visit_duration: "35.5",
              },
            ],
          },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    const result = await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      {
        orderBy: [{ field: "bounce_rate", direction: "desc" }],
        pagination: { limit: 5, offset: 0 },
        count: true,
      },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].dimension).toBe("/pricing");
    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain(
      "ORDER BY CASE WHEN visits > 0 THEN bounces / visits * 100 ELSE 0 END DESC, dimension ASC",
    );
    expect(query).toContain("COUNT(*) OVER () AS total_rows");
    expect(query).toContain("WHERE row_num > 0");
    expect(query).toContain("AND row_num <= 5");
    expect(query).not.toContain("LIMIT 10001");
  });

  test("renders dimension ordering for paginated time breakdowns", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "time:day",
      undefined,
      { orderBy: [{ field: "dimension", direction: "asc" }], pagination: { limit: 10, offset: 0 } },
    );
    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("ROW_NUMBER() OVER (ORDER BY dimension ASC) AS row_num");
    expect(query).toContain("WHERE row_num > 0");
    expect(query).toContain("AND row_num <= 10");
  });

  test("counts an empty deep page with a fallback count query", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [{ total: "3" }] },
          }),
        ),
      );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    const result = await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      {
        orderBy: [{ field: "visitors", direction: "desc" }],
        pagination: { limit: 5, offset: 100 },
        count: true,
      },
    );

    expect(result).toEqual({ rows: [], totalRows: 3 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const countQuery = JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body))
      .query as string;
    expect(countQuery).toContain("SELECT COUNT(*) AS total FROM grouped");
    expect(countQuery).not.toContain("OFFSET");
  });

  test("counts an empty deep page for basic metrics with a fallback query", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [{ total: "7" }] },
          }),
        ),
      );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    const result = await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      {
        orderBy: [{ field: "visitors", direction: "desc" }],
        pagination: { limit: 5, offset: 50 },
        count: true,
      },
    );

    expect(result).toEqual({ rows: [], totalRows: 7 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("rejects unsupported order fields for basic metrics", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(
      api.getBasicMetrics(
        "example.com",
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-02T00:00:00.000Z"),
        {},
        "event:page",
        undefined,
        { orderBy: [{ field: "visits", direction: "desc" }], pagination: { limit: 1, offset: 0 } },
      ),
    ).rejects.toThrow("Unsupported R2 order field for basic metrics: visits");
  });

  test("surfaces R2 SQL errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("query rejected", { status: 400 }));
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(api.query("SELECT 1")).rejects.toThrow(
      "R2 SQL query failed (400): query rejected",
    );
  });

  test("surfaces successful HTTP responses containing API errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 40004, message: "Invalid query" }],
        }),
        { status: 200 },
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(api.query("SELECT 1")).rejects.toThrow("40004: Invalid query");
  });

  test("deduplicates canonical event IDs before session metrics aggregation", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [
              {
                views: "1",
                events: "1",
                visitors: "1",
                visits: "1",
                bounces: "0",
                average_visit_duration: "8",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getSessionMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
    );

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toMatch(/ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY COALESCE\(event_id, ''\)/);
    expect(query).toContain("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)");
    expect(query.indexOf("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)")).toBeLessThan(
      query.indexOf("sessions AS ("),
    );
    expect(query).toContain("ORDER BY received_at, visitor_id, event_type, event_id");
  });

  test("deduplicates canonical event IDs before basic metrics aggregation", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
    );

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toMatch(/ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY COALESCE\(event_id, ''\)/);
    expect(query).toContain("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)");
    expect(query.indexOf("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)")).toBeLessThan(
      query.indexOf("GROUP BY dimension"),
    );
  });

  test("deduplicates canonical event IDs before session breakdown sessionization", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
    );

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toMatch(/ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY COALESCE\(event_id, ''\)/);
    expect(query).toContain("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)");
    const dedupeFilterIndex = query.indexOf("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)");
    expect(dedupeFilterIndex).toBeLessThan(query.indexOf("sessions AS ("));
    expect(dedupeFilterIndex).toBeLessThan(query.indexOf("event_metrics AS ("));
  });

  test("preserves empty and missing event IDs during deduplication", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [] },
        }),
      ),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
    );

    const query = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))
      .query as string;
    expect(query).toContain("COALESCE(event_id, '')");
    expect(query).toContain("= '' OR duplicate_rank = 1)");
    expect(query).not.toContain("PARTITION BY event_id");
  });

  test("applies deduplication in paginated session breakdown count fallback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [{ total: "0" }] },
          }),
        ),
      );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      { pagination: { limit: 5, offset: 10 }, count: true },
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    const countQuery = JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body))
      .query as string;
    expect(countQuery).toMatch(
      /ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY COALESCE\(event_id, ''\)/,
    );
    expect(countQuery).toContain("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)");
  });

  test("applies deduplication in paginated basic metrics count fallback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { rows: [{ total: "0" }] },
          }),
        ),
      );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      { pagination: { limit: 5, offset: 10 }, count: true },
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    const countQuery = JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body))
      .query as string;
    expect(countQuery).toMatch(
      /ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY COALESCE\(event_id, ''\)/,
    );
    expect(countQuery).toContain("(COALESCE(event_id, '') = '' OR duplicate_rank = 1)");
  });

  test("rejects unsafe table names", () => {
    expect(
      () => new R2SQLAPI("account", "bucket", "token", "analytics.events; DROP TABLE events"),
    ).toThrow("namespace.table format");
  });

  test("rejects malformed successful responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
      }),
    );
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );

    await expect(api.query("SELECT 1")).rejects.toThrow("invalid response");
  });
});

describe("query cache", () => {
  const okResponse = () =>
    new Response(JSON.stringify({ success: true, result: { rows: [{ n: 1 }] } }), { status: 200 });

  function mockCache() {
    const stored: { response: Response | null } = { response: null };
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async (_key: Request, res: Response) => {
        stored.response = res;
      }),
    };
    vi.stubGlobal("caches", { default: cache });
    return { cache, stored };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses 24h TTL when the range ended over 10 minutes ago", async () => {
    const { stored } = mockCache();
    const fetcher = vi.fn(async () => okResponse());
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher);
    await api.query("SELECT 1", Date.now() - 60 * 60 * 1000);
    expect(stored.response?.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  test("uses 60s TTL when the range is near-current", async () => {
    const { stored } = mockCache();
    const fetcher = vi.fn(async () => okResponse());
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher);
    await api.query("SELECT 1", Date.now());
    expect(stored.response?.headers.get("cache-control")).toBe("public, max-age=60");
  });

  test("does not cache errors", async () => {
    const { cache } = mockCache();
    const fetcher = vi.fn(async () => new Response("boom", { status: 500 }));
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher);
    await expect(api.query("SELECT 1")).rejects.toThrow();
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe("entry/exit page dimensions", () => {
  const captured = async (dimension: Parameters<R2SQLAPI["getSessionBreakdown"]>[4]) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: { rows: [] } }), { status: 200 }),
      );
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher as typeof fetch);
    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      dimension,
    );
    return JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)).query as string;
  };

  test("entry page uses the first pageview, deterministic on event_id", async () => {
    const query = await captured("visit:entry_page");
    expect(query).toContain(
      "FIRST_VALUE(dimension_value ORDER BY event_ts, event_id) FILTER (WHERE event_type = 'pageview') AS entry_page",
    );
    expect(query).not.toContain("AS exit_page");
    expect(query).toContain("SELECT visitor_id, session_number, entry_page AS dimension");
  });

  test("exit page adds the DESC aggregate and selects exit_page", async () => {
    const query = await captured("visit:exit_page");
    expect(query).toContain(
      "FIRST_VALUE(dimension_value ORDER BY event_ts DESC, event_id DESC) FILTER (WHERE event_type = 'pageview') AS exit_page",
    );
    expect(query).toContain("SELECT visitor_id, session_number, exit_page AS dimension");
  });

  test("non-exit dimension contains no exit_page", async () => {
    const query = await captured("visit:country");
    expect(query).not.toContain("exit_page");
  });

  test("event:name throws for session metrics", async () => {
    const fetcher = vi.fn();
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher as typeof fetch);
    await expect(
      api.getSessionBreakdown(
        "example.com",
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-02T00:00:00.000Z"),
        {},
        "event:name",
      ),
    ).rejects.toThrow("event:name does not support session metrics");
  });
});

describe("getGoalBreakdown", () => {
  const captured = async (
    goals: Array<{
      type: "event" | "pageview";
      value: string;
      customProps: Record<string, string>;
    }>,
  ) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { rows: [{ visitors: 9, u_0: 3, t_0: 5, u_1: 2, t_1: 2, any_uniques: 4 }] },
        }),
        { status: 200 },
      ),
    );
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher as typeof fetch);
    const result = await api.getGoalBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      goals,
    );
    return {
      result,
      query: JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)).query as string,
    };
  };

  test("one query with per-goal u_i/t_i columns and any_uniques", async () => {
    const { result, query } = await captured([
      { type: "event", value: "signup", customProps: {} },
      { type: "pageview", value: "/thanks", customProps: {} },
    ]);
    expect(query).toContain("COUNT(DISTINCT visitor_id) AS visitors");
    expect(query).toContain(
      "COUNT(DISTINCT CASE WHEN (event_type <> 'engagement' AND event_name = 'signup') THEN visitor_id END) AS u_0",
    );
    expect(query).toContain(
      "SUM(CASE WHEN (event_type <> 'engagement' AND event_name = 'signup') THEN 1 ELSE 0 END) AS t_0",
    );
    expect(query).toContain(
      "COUNT(DISTINCT CASE WHEN (event_type = 'pageview' AND pathname = '/thanks') THEN visitor_id END) AS u_1",
    );
    expect(query).toContain(
      "COUNT(DISTINCT CASE WHEN (event_type <> 'engagement' AND event_name = 'signup') OR (event_type = 'pageview' AND pathname = '/thanks') THEN visitor_id END) AS any_uniques",
    );
    expect(result).toEqual({
      visitors: 9,
      goals: [
        { uniques: 3, total: 5, revenue: null },
        { uniques: 2, total: 2, revenue: null },
      ],
      anyUniques: 4,
      anyRevenue: null,
    });
  });

  test("custom props predicate escapes values", async () => {
    const { query } = await captured([
      { type: "event", value: "plan", customProps: { tier: "pro's" } },
    ]);
    expect(query).toContain("json_get_str(event_properties, 'tier') = 'pro''s'");
  });

  test("bad prop key throws", async () => {
    const api = new R2SQLAPI("a", "b", "t", "n.e", vi.fn() as never);
    await expect(
      api.getGoalBreakdown("s", new Date(), new Date(), {}, [
        { type: "event", value: "x", customProps: { "bad key!": "1" } },
      ]),
    ).rejects.toThrow("Invalid goal property key");
  });

  test("empty goals selects no per-goal columns", async () => {
    const { query, result } = await captured([]);
    expect(query).not.toContain(" u_0");
    expect(query).not.toContain("any_uniques");
    expect(result.goals).toEqual([]);
  });
});

describe("getGoalBreakdown revenue", () => {
  const captured = async (
    goals: Array<{
      type: "event" | "pageview";
      value: string;
      customProps: Record<string, string>;
      currency?: string | null;
    }>,
  ) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            rows: [
              {
                visitors: 9,
                u_0: 3,
                t_0: 5,
                r_0: 42.5,
                rc_0: 2,
                u_1: 1,
                t_1: 1,
                any_uniques: 4,
                any_rev_total: 42.5,
                any_rev_count: 2,
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const api = new R2SQLAPI("acct", "bucket", "token", "noomers.events", fetcher as typeof fetch);
    const result = await api.getGoalBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      goals,
    );
    return {
      result,
      query: JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)).query as string,
    };
  };

  test("revenue goals get r_i/rc_i columns with currency equality and TRY_CAST", async () => {
    const { result, query } = await captured([
      { type: "event", value: "buy", customProps: {}, currency: "USD" },
      { type: "event", value: "free", customProps: {} },
    ]);
    expect(query).toContain(
      "SUM(CASE WHEN (event_type <> 'engagement' AND event_name = 'buy') AND revenue_currency = 'USD' AND TRY_CAST(revenue_amount AS DOUBLE) IS NOT NULL THEN TRY_CAST(revenue_amount AS DOUBLE) ELSE 0 END) AS r_0",
    );
    expect(query).toContain("AS rc_0");
    expect(query).not.toContain("r_1");
    expect(query).toContain("revenue_amount, revenue_currency");
    expect(query).toContain("AS any_rev_total");
    expect(result.goals[0].revenue).toEqual({ total: 42.5, count: 2 });
    expect(result.goals[1].revenue).toBeNull();
    expect(result.anyRevenue).toEqual({ total: 42.5, count: 2 });
  });

  test("no revenue goals → no revenue columns or CTE fields", async () => {
    const { result, query } = await captured([{ type: "event", value: "x", customProps: {} }]);
    expect(query).not.toContain("revenue_");
    expect(result.goals[0].revenue).toBeNull();
    expect(result.anyRevenue).toBeNull();
  });
});

describe("ORDER BY without pagination", () => {
  const emptyRows = () =>
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, result: { rows: [] } })));
  const lastQuery = (fetcher: ReturnType<typeof vi.fn>) =>
    JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string).query as string;

  test("getSessionBreakdown applies orderBy without pagination", async () => {
    const fetcher = emptyRows();
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );
    await api.getSessionBreakdown(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      { orderBy: [{ field: "visitors", direction: "desc" }] },
    );
    expect(lastQuery(fetcher)).toContain("ORDER BY visitors DESC, dimension ASC LIMIT 10001");
  });

  test("getBasicMetrics applies orderBy without pagination", async () => {
    const fetcher = emptyRows();
    const api = new R2SQLAPI(
      "account",
      "bucket",
      "token",
      "analytics.events",
      fetcher as typeof fetch,
    );
    await api.getBasicMetrics(
      "example.com",
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      {},
      "event:page",
      undefined,
      { orderBy: [{ field: "pageviews", direction: "desc" }] },
    );
    expect(lastQuery(fetcher)).toContain("ORDER BY views DESC, dimension ASC LIMIT 10001");
  });
});
