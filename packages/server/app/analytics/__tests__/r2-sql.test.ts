import { describe, expect, test, vi } from "vitest";
import { R2SQLAPI } from "../r2-sql";

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
            "https://api.sql.cloudflarestorage.com/api/v1/accounts/account%2Fid/r2-sql/query/events%20bucket",
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

    test("returns zeroes when the query has no rows", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                new Response(
                    JSON.stringify({ success: true, result: { rows: [] } }),
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
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true,
            result: {
                rows: [{
                    dimension: "/pricing",
                    views: "8",
                    events: "10",
                    visitors: "4",
                    visits: "5",
                    bounces: "2",
                    average_visit_duration: "35.5",
                }],
            },
        })));
        const api = new R2SQLAPI(
            "account",
            "bucket",
            "token",
            "analytics.events",
            fetcher as typeof fetch,
        );

        await expect(api.getSessionBreakdown(
            "example.com",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-02T00:00:00.000Z"),
            { host: "example.com" },
            "event:page",
        )).resolves.toEqual([{
            dimension: "/pricing",
            views: 8,
            events: 10,
            visitors: 4,
            visits: 5,
            bounces: 2,
            averageVisitDuration: 35.5,
        }]);

        const query = JSON.parse(String(
            (fetcher.mock.calls[0][1] as RequestInit).body,
        )).query as string;
        expect(query).toContain("hostname = 'example.com'");
        expect(query).toContain("pathname AS dimension");
        expect(query).toContain("MIN_BY(pathname, event_ts) FILTER (WHERE event_type = 'pageview') AS entry_page");
        expect(query).toContain("SELECT visitor_id, session_number, entry_page AS dimension");
        expect(query).toContain("sessions.interactive_events <= 1");
        expect(query).toContain("LEFT JOIN session_metrics");
        expect(query).toContain("LIMIT 10001");
    });

    test("builds lightweight aggregate queries for basic metrics", async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true,
            result: {
                rows: [{ dimension: "/pricing", visitors: "4", views: "8", events: "10" }],
            },
        })));
        const api = new R2SQLAPI(
            "account",
            "bucket",
            "token",
            "analytics.events",
            fetcher as typeof fetch,
        );

        await expect(api.getBasicMetrics(
            "example.com",
            new Date("2026-08-01T10:15:00.250Z"),
            new Date("2026-08-01T12:05:00.750Z"),
            { host: "example.com" },
            "event:page",
        )).resolves.toEqual([{
            dimension: "/pricing",
            visitors: 4,
            views: 8,
            events: 10,
        }]);

        const query = JSON.parse(String(
            (fetcher.mock.calls[0][1] as RequestInit).body,
        )).query as string;
        expect(query).toContain("received_at >= '2026-08-01T10:15:00.250Z'");
        expect(query).toContain("received_at < '2026-08-01T12:05:00.750Z'");
        expect(query).toContain("hostname = 'example.com'");
        expect(query).toContain("pathname AS dimension");
        expect(query).toContain("event_type <> 'engagement'");
    });

    test("renders Stats API filter operators", async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true,
            result: { rows: [] },
        })));
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

        const query = JSON.parse(String(
            (fetcher.mock.calls[0][1] as RequestInit).body,
        )).query as string;
        expect(query).toContain("pathname AS dimension");
        expect(query).toContain("hostname NOT IN ('internal.example', 'preview.example')");
        expect(query).toContain("strpos(pathname, 'pricing') > 0 OR strpos(pathname, 'plans') > 0");
        expect(query).toContain("strpos(pathname, 'internal') = 0");
    });

    test("uses visit start for session time buckets", async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true,
            result: { rows: [] },
        })));
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
        const query = JSON.parse(String(
            (fetcher.mock.calls[0][1] as RequestInit).body,
        )).query as string;
        expect(query).toContain("date_trunc('hour', event_ts) AS dimension");
        expect(query).toContain("date_trunc('hour', visit_start) AS dimension");
    });

    test("uses explicit UTC boundaries for reporting-timezone buckets", async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true,
            result: { rows: [] },
        })));
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
            [{
                label: "2026-03-08",
                start: new Date("2026-03-08T08:00:00.000Z"),
                end: new Date("2026-03-09T07:00:00.000Z"),
            }],
        );
        const query = JSON.parse(String(
            (fetcher.mock.calls[0][1] as RequestInit).body,
        )).query as string;
        expect(query).toContain(
            "WHEN event_ts >= TRY_CAST('2026-03-08T08:00:00.000Z' AS TIMESTAMP)",
        );
        expect(query).toContain(
            "event_ts < TRY_CAST('2026-03-09T07:00:00.000Z' AS TIMESTAMP)",
        );
        expect(query).toContain("THEN '2026-03-08'");
        expect(query).toContain("WHEN visit_start >= TRY_CAST");
    });

    test("surfaces R2 SQL errors", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(new Response("query rejected", { status: 400 }));
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

        await expect(api.query("SELECT 1")).rejects.toThrow(
            "40004: Invalid query",
        );
    });

    test("rejects unsafe table names", () => {
        expect(
            () =>
                new R2SQLAPI(
                    "account",
                    "bucket",
                    "token",
                    "analytics.events; DROP TABLE events",
                ),
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
