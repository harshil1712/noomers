import {
    describe,
    expect,
    test,
    vi,
    beforeEach,
    afterEach,
    Mock,
    beforeAll,
} from "vitest";

import { AnalyticsEngineAPI, intervalToSql } from "../query";
import { getDateTimeRange } from "~/lib/utils";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// Render a Date as Analytics Engine expects it: the same UTC instant string
// that query.ts derives from the explicit interval boundary dates.
function dayjsUtc(date: Date): string {
    return dayjs(date).tz("UTC").utc().format("YYYY-MM-DD HH:mm:ss");
}

function createFetchResponse<T>(data: T) {
    return {
        ok: true,
        json: () => new Promise<T>((resolve) => resolve(data)),
    };
}

describe("AnalyticsEngineAPI", () => {
    const api = new AnalyticsEngineAPI(
        "test_account_id_abc123",
        "test_api_token_def456",
    );
    let fetch: Mock; // todo: figure out how to type this mocked fetch

    function mockQueryResponses(primary: unknown) {
        fetch.mockImplementation((_url: string, _init: RequestInit) =>
            Promise.resolve(createFetchResponse(primary)),
        );
    }

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("query", () => {
        test("forms a valid HTTP request query for CF analytics engine", () => {
            fetch.mockResolvedValue(createFetchResponse({}));

            api.query("SELECT * FROM web_counter");

            expect(fetch).toHaveBeenCalledWith(
                "https://api.cloudflare.com/client/v4/accounts/test_account_id_abc123/analytics_engine/sql",
                {
                    body: "SELECT * FROM web_counter",
                    headers: {
                        Authorization: "Bearer test_api_token_def456",
                        "X-Source": "Cloudflare-Workers",
                        "content-type": "application/json;charset=UTF-8",
                    },
                    method: "POST",
                },
            );
        });
    });

    describe("getViewsGroupedByInterval", () => {
        test("should return an array of [timestamp, count] tuples grouped by day", async () => {
            expect(process.env.TZ).toBe("EST");

            mockQueryResponses({
                data: [
                    {
                        count: 3,
                        // note: intentionally sparse data (data for some timestamps missing)
                        bucket: "2024-01-13 05:00:00",
                    },
                    {
                        count: 2,
                        bucket: "2024-01-16 05:00:00",
                    },
                    {
                        count: 1,
                        bucket: "2024-01-17 05:00:00",
                    },
                ],
            });

            vi.setSystemTime(new Date("2024-01-18T09:33:02").getTime());

            const result1 = await api.getViewsGroupedByInterval(
                "example.com",
                "DAY",
                new Date("2024-01-11 00:00:00"), // local time (because tz also passed)
                new Date(),
                "America/New_York",
            );

            // results should all be at 05:00:00 because local timezone is UTC-5 --
            // this set of results represents "start of day" in local tz, which is 5 AM UTC
            expect(result1).toEqual([
                ["2024-01-11 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-12 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-13 05:00:00", { views: 3, visitors: 0, bounces: 0 }],
                ["2024-01-14 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-15 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-16 05:00:00", { views: 2, visitors: 0, bounces: 0 }],
                ["2024-01-17 05:00:00", { views: 1, visitors: 0, bounces: 0 }],
                ["2024-01-18 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
            ]);

            const result2 = await api.getViewsGroupedByInterval(
                "example.com",
                "DAY",
                new Date("2024-01-13 00:00:00"), // local time (because tz also passed)
                new Date(),
                "America/New_York",
            );
            expect(result2).toEqual([
                ["2024-01-13 05:00:00", { views: 3, visitors: 0, bounces: 0 }],
                ["2024-01-14 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-15 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-16 05:00:00", { views: 2, visitors: 0, bounces: 0 }],
                ["2024-01-17 05:00:00", { views: 1, visitors: 0, bounces: 0 }],
                ["2024-01-18 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
            ]);
        });

        test("should return an array of [timestamp, count] tuples grouped by hour", async () => {
            expect(process.env.TZ).toBe("EST");

            mockQueryResponses({
                data: [
                    {
                        count: 3,
                        isVisitor: 0,
                        isBounce: 0,
                        // note: intentionally sparse data (data for some timestamps missing)
                        bucket: "2024-01-17 11:00:00",
                    },
                    {
                        count: 2,
                        isVisitor: 0,
                        isBounce: 0,
                        bucket: "2024-01-17 14:00:00",
                    },
                    {
                        count: 1,
                        isVisitor: 0,
                        isBounce: 0,
                        bucket: "2024-01-17 16:00:00",
                    },
                ],
            });

            vi.setSystemTime(new Date("2024-01-18T05:33:02").getTime());

            const result1 = await api.getViewsGroupedByInterval(
                "example.com",
                "HOUR",
                new Date("2024-01-17 05:00:00"), // local time (because tz also passed)
                new Date(),
                "America/New_York",
            );

            // reminder results are expressed as UTC
            // so if we want the last 24 hours from 05:00:00 in local time (EST), the actual
            // time range in UTC starts and ends at 10:00:00 (+5 hours)
            expect(result1).toEqual([
                ["2024-01-17 10:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 11:00:00", { views: 3, visitors: 0, bounces: 0 }],
                ["2024-01-17 12:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 13:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 14:00:00", { views: 2, visitors: 0, bounces: 0 }],
                ["2024-01-17 15:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 16:00:00", { views: 1, visitors: 0, bounces: 0 }],
                ["2024-01-17 17:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 18:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 19:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 20:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 21:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 22:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-17 23:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 00:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 01:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 02:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 03:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 04:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 05:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 06:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 07:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 08:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 09:00:00", { views: 0, visitors: 0, bounces: 0 }],
                ["2024-01-18 10:00:00", { views: 0, visitors: 0, bounces: 0 }],
            ]);
        });

        test("corrects negative bounce values by moving them to previous bucket", async () => {
            const mockResponse = {
                data: [
                    // First bucket has 10 bounces
                    {
                        bucket: "2024-01-01 00:00:00",
                        count: 10,
                        isVisitor: 1,
                        isBounce: 1,
                    },
                    {
                        bucket: "2024-01-01 00:00:00",
                        count: 2,
                        isVisitor: 1,
                        isBounce: -1,
                    },
                    // Second bucket has -2 bounces (which should get moved to first bucket)
                    {
                        bucket: "2024-01-01 01:00:00",
                        count: 8,
                        isVisitor: 1,
                        isBounce: 1,
                    },
                    {
                        bucket: "2024-01-01 01:00:00",
                        count: 10, // 8 - 10 = -2
                        isVisitor: 1,
                        isBounce: -1,
                    },
                    {
                        bucket: "2024-01-01 02:00:00",
                        count: 20,
                        isVisitor: 1,
                        isBounce: 1,
                    },
                    {
                        bucket: "2024-01-01 02:00:00",
                        count: 8,
                        isVisitor: 1,
                        isBounce: -1,
                    },
                ],
                meta: { total: 3 },
            };

            mockQueryResponses(mockResponse);
            vi.setSystemTime(new Date("2024-01-18T05:33:02").getTime());

            const result = await api.getViewsGroupedByInterval(
                "test-site",
                "HOUR",
                new Date("2024-01-01"),
                new Date("2024-01-02"),
                "America/New_York",
            );

            expect(result).toHaveLength(24); // still returns 24 buckets

            // First bucket should have had its bounces reduced by 2
            expect(result[0][1].bounces).toBe(6);
            // Second bucket should have been zeroed out
            expect(result[1][1].bounces).toBe(0);
            // Third bucket should be unchanged
            expect(result[2][1].bounces).toBe(12);
        });
    });

    describe("getCounts", () => {
        test("should return an object with view, visitor, and bounce counts", async () => {
            mockQueryResponses({
                data: [
                    {
                        count: 3,
                        isVisitor: 0,
                        isBounce: 1,
                    },
                    {
                        count: 2,
                        isVisitor: 0,
                        isBounce: 0,
                    },
                    {
                        count: 1,
                        isVisitor: 1,
                        isBounce: -1,
                    },
                ],
            });

            const result = api.getCounts("example.com", "7d");

            // verify fetch was invoked before awaiting result
            expect(fetch).toHaveBeenCalled();
            expect(await result).toEqual({
                views: 6,
                visitors: 1,
                bounces: 2,
            });
        });

        test("escapes site IDs and filters", async () => {
            fetch.mockResolvedValue(createFetchResponse({ data: [] }));

            await api.getCounts("owner\\'s site", "7d", "UTC", {
                path: "/it\\'s-here",
            });

            const query = fetch.mock.calls[0][1].body as string;
            expect(query).toContain("blob8 = 'owner\\\\''s site'");
            expect(query).toContain("blob3 = '/it\\\\''s-here'");
        });

        test("counts distinct Plausible visitor IDs", async () => {
            mockQueryResponses({
                data: [
                    {
                        count: 4,
                        distinctVisitors: 2,
                        isVisitor: -1,
                        isBounce: 0,
                    },
                ],
            });

            await expect(api.getCounts("example.com", "7d")).resolves.toEqual({
                views: 4,
                visitors: 2,
                bounces: 0,
            });
            expect(fetch.mock.calls[0][1].body).toContain(
                "count(DISTINCT blob18)",
            );
        });
    });

    describe("getCountsForRange", () => {
        test("uses explicit half-open boundaries converted from the supplied dates", async () => {
            vi.setSystemTime(new Date("2023-01-08T00:00:00Z").getTime());
            fetch.mockResolvedValue(createFetchResponse({ data: [] }));

            const startDate = new Date("2023-01-01T00:00:00Z");
            const endDate = new Date("2023-01-08T00:00:00Z");

            await api.getCountsForRange(
                "example.com",
                startDate,
                endDate,
                "UTC",
            );

            const query = fetch.mock.calls[0][1].body as string;
            expect(query).toContain(
                "timestamp >= toDateTime('2023-01-01 00:00:00')",
            );
            expect(query).toContain(
                "timestamp < toDateTime('2023-01-08 00:00:00')",
            );
        });

        test("matches the boundaries the R2 session path queries for the same interval", async () => {
            vi.setSystemTime(new Date("2023-01-08T12:00:00Z").getTime());
            fetch.mockResolvedValue(createFetchResponse({ data: [] }));

            // The dashboard loader derives these exact dates via getDateTimeRange
            // and passes them to BOTH R2 getSessionMetrics and the realtime
            // fallback, so the AE query must not recompute its own boundaries.
            const { startDate, endDate } = getDateTimeRange("7d", "UTC");
            await api.getCountsForRange(
                "example.com",
                startDate,
                endDate,
                "UTC",
            );

            const query = fetch.mock.calls[0][1].body as string;
            expect(query).toContain(
                `timestamp >= toDateTime('${dayjsUtc(startDate)}')`,
            );
            expect(query).toContain(
                `timestamp < toDateTime('${dayjsUtc(endDate)}')`,
            );
        });

        test("converts non-UTC timezone instants to the same UTC boundaries as R2", async () => {
            vi.setSystemTime(new Date("2023-07-01T00:00:00Z").getTime());
            fetch.mockResolvedValue(createFetchResponse({ data: [] }));

            const { startDate, endDate } = getDateTimeRange(
                "7d",
                "America/New_York",
            );
            await api.getCountsForRange(
                "example.com",
                startDate,
                endDate,
                "America/New_York",
            );

            const query = fetch.mock.calls[0][1].body as string;
            expect(query).toContain(
                `timestamp >= toDateTime('${dayjsUtc(startDate)}')`,
            );
            expect(query).toContain(
                `timestamp < toDateTime('${dayjsUtc(endDate)}')`,
            );
        });
    });

    describe("getVisitorCountByColumn", () => {
        test("it should map logical columns to schema columns and return an array of [column, count] tuples", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob4: "CA",
                        count: 3,
                    },
                    {
                        blob4: "US",
                        count: 2,
                    },
                    {
                        blob4: "GB",
                        count: 1,
                    },
                ],
            });

            const result = api.getVisitorCountByColumn(
                "example.com",
                "country",
                "7d",
            );

            // verify fetch was invoked before awaiting result
            expect(fetch).toHaveBeenCalled();
            expect(await result).toEqual([
                ["CA", 3],
                ["US", 2],
                ["GB", 1],
            ]);
            expect(fetch.mock.calls[0][1].body).toContain(
                "ORDER BY distinctVisitors + legacyVisitors - ceil(missingVisitorIds / (missingVisitorIds + 1)) DESC",
            );
        });

        test("it excludes the empty visitor ID used by legacy events", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob4: "US",
                        count: 5,
                        distinctVisitors: 3,
                        missingVisitorIds: 2,
                        legacyVisitors: 2,
                    },
                ],
            });

            await expect(
                api.getVisitorCountByColumn("example.com", "country", "7d"),
            ).resolves.toEqual([["US", 4]]);
        });
    });

    describe("getSitesOrderedByHits", () => {
        test("it should return an array of [siteId, count] tuples", async () => {
            // note: getSitesByHits orders by count descending in SQL; since we're mocking
            //       the HTTP/SQL response, the mocked results are pre-sorted
            mockQueryResponses({
                data: [
                    {
                        siteId: "example.com",
                        count: 130,
                    },
                    {
                        siteId: "foo.com",
                        count: 100,
                    },
                    {
                        siteId: "test.dev",
                        count: 90,
                    },
                ],
            });

            const result = api.getSitesOrderedByHits("7d");
            // verify fetch was invoked before awaiting result
            expect(fetch).toHaveBeenCalled();
            expect(await result).toEqual([
                ["example.com", 130],
                ["foo.com", 100],
                ["test.dev", 90],
            ]);
        });
    });

    describe("getAllCountsByColumn", () => {
        test("it should return an array of [column, count] tuples", async () => {
            fetch.mockImplementation((_url: string, init: RequestInit) => {
                const query = String(init.body);
                const data = query.includes("countIf(blob18 = '')")
                    ? [{ blob4: "CA", isVisitor: 1, count: 3 }]
                    : [{ blob4: "CA", count: 4 }];
                return Promise.resolve(createFetchResponse({ data }));
            });

            const result = await api.getAllCountsByColumn(
                "example.com",
                "country",
                "7d",
                "America/New_York",
                {
                    country: "CA",
                },
            );

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(
                (fetch as Mock).mock.calls[0][1].body
                    .replace(/\s+/g, " ") // removes tabs and whitespace from query
                    .trim(),
            );
            // console.log(result);
            expect(await result).toEqual({
                CA: {
                    views: 4,
                    visitors: 3,
                    bounces: 0,
                },
            });
        });

        test("escapes result keys before using them in an IN clause", async () => {
            fetch.mockImplementation((_url: string, init: RequestInit) => {
                const query = String(init.body);
                const data = query.includes("countIf(blob18 = '')")
                    ? [{ blob3: "/it's-here", count: 1 }]
                    : [];
                return Promise.resolve(createFetchResponse({ data }));
            });

            await api.getAllCountsByColumn("example.com", "path", "7d");

            expect(fetch.mock.calls[1][1].body).toContain(
                "blob3 IN ('/it''s-here')",
            );
        });

        test("should handle case where there are no results", async () => {
            fetch.mockResolvedValue(createFetchResponse({ data: [] }));

            const result = await api.getAllCountsByColumn(
                "example.com",
                "path",
                "DAY",
                "America/New_York",
            );

            expect(result).toEqual({});
            expect(fetch).toHaveBeenCalledOnce();
        });
    });

    describe("custom events", () => {
        test("returns paginated event counts", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        { eventName: "Signup", count: 12 },
                        { eventName: "Download", count: 7 },
                    ],
                }),
            );

            const result = await api.getCountByEventName("example.com", "7d");

            expect(result).toEqual([
                ["Signup", 12],
                ["Download", 7],
            ]);
            expect((fetch as Mock).mock.calls[0][1].body).toContain(
                "blob16 != ''",
            );
        });
    });

    describe("goals", () => {
        test("counts distinct attributed visitors for an event goal", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({ data: [{ conversions: 4 }] }),
            );

            const result = await api.getGoalConversionCount(
                "example.com",
                { type: "event", value: "Signup's complete" },
                "7d",
                "UTC",
            );

            expect(result).toBe(4);
            const query = (fetch as Mock).mock.calls[0][1].body as string;
            expect(query).toContain("count(DISTINCT blob18)");
            expect(query).toContain("blob16 = 'Signup''s complete'");
            expect(query).toContain("blob18 != ''");
        });

        test("matches pageview goals without including custom events", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({ data: [{ conversions: "2" }] }),
            );

            expect(
                await api.getGoalConversionCount(
                    "example.com",
                    { type: "pageview", value: "/thank-you" },
                    "7d",
                ),
            ).toBe(2);
            const query = (fetch as Mock).mock.calls[0][1].body as string;
            expect(query).toContain("blob16 = '' AND blob3 = '/thank-you'");
        });
    });

    describe("archive export query", () => {
        test("aliases timestamps to the date key consumed by the exporter", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        {
                            date: "2024-01-01 12:00:00",
                            siteId: "example.com",
                            eventName: "Signup",
                            count: 2,
                            isVisitor: 0,
                            isBounce: 0,
                        },
                    ],
                }),
            );

            const result = await api.getAllCountsByAllColumnsForAllSites(
                ["eventName"],
                new Date("2024-01-01T00:00:00Z"),
                new Date("2024-01-02T00:00:00Z"),
                "UTC",
            );

            expect([...result.keys()]).toEqual([
                ["2024-01-01 12:00:00", "example.com", "Signup"],
            ]);
            expect([...result.values()]).toEqual([
                { views: 0, visitors: 0, bounces: 0, events: 2 },
            ]);
            expect((fetch as Mock).mock.calls[0][1].body).toContain(
                "toStartOfDay(timestamp) as date",
            );
        });

        test("counts distinct Plausible visitors in daily rollups", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        {
                            date: "2024-01-01 00:00:00",
                            siteId: "example.com",
                            eventName: "",
                            count: 4,
                            distinctVisitors: 2,
                            missingVisitorIds: 0,
                            legacyVisitors: 0,
                            bounces: 1,
                        },
                    ],
                }),
            );

            const result = await api.getAllCountsByAllColumnsForAllSites(
                ["eventName"],
                new Date("2024-01-01T00:00:00Z"),
                new Date("2024-01-02T00:00:00Z"),
                "UTC",
            );

            expect([...result.values()]).toEqual([
                { views: 4, visitors: 2, bounces: 1, events: 0 },
            ]);
        });
    });

    describe("getEarliestEvents", () => {
        test("returns both earliest event and bounce dates when found", async () => {
            const mockEventTimestamp = "2024-01-01T10:00:00Z";
            const mockBounceTimestamp = "2024-01-01T12:00:00Z";

            // Mock responses for both queries
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    ok: true,
                    data: [
                        { earliestEvent: mockBounceTimestamp, isBounce: 1 },
                        { earliestEvent: mockEventTimestamp, isBounce: 0 },
                    ],
                }),
            );

            const result = await api.getEarliestEvents("test-site");
            expect(result).toEqual({
                earliestEvent: new Date(mockEventTimestamp),
                earliestBounce: new Date(mockBounceTimestamp),
            });
        });

        test("returns only earliest event when no bounces found", async () => {
            const mockEventTimestamp = "2024-01-01T10:00:00Z";

            // Mock responses for both queries
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    ok: true,
                    data: [{ earliestEvent: mockEventTimestamp, isBounce: 0 }],
                }),
            );

            const result = await api.getEarliestEvents("test-site");
            expect(result).toEqual({
                earliestEvent: new Date(mockEventTimestamp),
                earliestBounce: null,
            });
        });
    });

    describe("UTM query methods", () => {
        test("getCountByUtmSource should return visitor counts by UTM source", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob11: "google",
                        count: 50,
                    },
                    {
                        blob11: "facebook",
                        count: 30,
                    },
                    {
                        blob11: "twitter",
                        count: 20,
                    },
                ],
            });

            const result = await api.getCountByUtmSource("example.com", "7d");

            expect(fetch).toHaveBeenCalled();
            expect(result).toEqual([
                ["google", 50],
                ["facebook", 30],
                ["twitter", 20],
            ]);
        });

        test("getCountByUtmMedium should return visitor counts by UTM medium", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob12: "cpc",
                        count: 40,
                    },
                    {
                        blob12: "email",
                        count: 35,
                    },
                    {
                        blob12: "social",
                        count: 25,
                    },
                ],
            });

            const result = await api.getCountByUtmMedium("example.com", "7d");

            expect(fetch).toHaveBeenCalled();
            expect(result).toEqual([
                ["cpc", 40],
                ["email", 35],
                ["social", 25],
            ]);
        });

        test("getCountByUtmCampaign should return visitor counts by UTM campaign", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob13: "summer_sale",
                        count: 60,
                    },
                    {
                        blob13: "newsletter",
                        count: 40,
                    },
                ],
            });

            const result = await api.getCountByUtmCampaign("example.com", "7d");

            expect(fetch).toHaveBeenCalled();
            expect(result).toEqual([
                ["summer_sale", 60],
                ["newsletter", 40],
            ]);
        });

        test("getCountByUtmTerm should return visitor counts by UTM term", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob14: "analytics",
                        count: 15,
                    },
                    {
                        blob14: "web tracking",
                        count: 10,
                    },
                ],
            });

            const result = await api.getCountByUtmTerm("example.com", "7d");

            expect(fetch).toHaveBeenCalled();
            expect(result).toEqual([
                ["analytics", 15],
                ["web tracking", 10],
            ]);
        });

        test("getCountByUtmContent should return visitor counts by UTM content", async () => {
            mockQueryResponses({
                data: [
                    {
                        blob15: "banner_ad",
                        count: 25,
                    },
                    {
                        blob15: "text_link",
                        count: 15,
                    },
                ],
            });

            const result = await api.getCountByUtmContent("example.com", "7d");

            expect(fetch).toHaveBeenCalled();
            expect(result).toEqual([
                ["banner_ad", 25],
                ["text_link", 15],
            ]);
        });
    });
});

describe("intervalToSql", () => {
    beforeAll(() => {
        vi.setSystemTime(new Date("2024-04-29T09:33:02").getTime());
    });

    // test intervalToSql
    test("should return the proper sql interval for 1d, 30d, 90d, etc (days)", () => {
        expect(intervalToSql("1d")).toStrictEqual({
            startIntervalSql:
                "toStartOfInterval(NOW() - INTERVAL '1' DAY, INTERVAL '5' MINUTE)",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '5' MINUTE)",
        });
        expect(intervalToSql("30d")).toStrictEqual({
            startIntervalSql:
                "toStartOfInterval(NOW() - INTERVAL '30' DAY, INTERVAL '5' MINUTE)",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '5' MINUTE)",
        });
        expect(intervalToSql("90d")).toStrictEqual({
            startIntervalSql:
                "toStartOfInterval(NOW() - INTERVAL '90' DAY, INTERVAL '5' MINUTE)",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '5' MINUTE)",
        });
    });

    test("should return the proper tz-adjusted sql interval for 'today'", () => {
        expect(intervalToSql("today", "America/New_York")).toStrictEqual({
            startIntervalSql: "toDateTime('2024-04-29 04:00:00')",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '5' MINUTE)",
        });
        expect(intervalToSql("today", "America/Los_Angeles")).toStrictEqual({
            startIntervalSql: "toDateTime('2024-04-29 07:00:00')",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '5' MINUTE)",
        });
    });

    test("should return the proper tz-adjusted sql interval for 'yesterday'", () => {
        expect(intervalToSql("yesterday", "America/New_York")).toStrictEqual({
            startIntervalSql: "toDateTime('2024-04-28 04:00:00')",
            endIntervalSql: "toDateTime('2024-04-29 04:00:00')",
        });
        expect(intervalToSql("yesterday", "America/Los_Angeles")).toStrictEqual(
            {
                startIntervalSql: "toDateTime('2024-04-28 07:00:00')",
                endIntervalSql: "toDateTime('2024-04-29 07:00:00')",
            },
        );
    });

    test("should support custom bucket intervals", () => {
        expect(intervalToSql("1d", undefined, 10)).toStrictEqual({
            startIntervalSql:
                "toStartOfInterval(NOW() - INTERVAL '1' DAY, INTERVAL '10' MINUTE)",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '10' MINUTE)",
        });
        expect(intervalToSql("today", "America/New_York", 15)).toStrictEqual({
            startIntervalSql: "toDateTime('2024-04-29 04:00:00')",
            endIntervalSql: "toStartOfInterval(NOW(), INTERVAL '15' MINUTE)",
        });
    });
});
