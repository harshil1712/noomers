import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { loader } from "../resources.stats";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("resources.stats loader", () => {
    let mockGetCounts: any;
    beforeEach(() => {
        mockGetCounts = vi.fn().mockResolvedValue({
            views: 1000,
            visitors: 250,
            bounces: 125,
        });
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    test("returns formatted stats from analytics engine", async () => {
        vi.setSystemTime(new Date("2023-01-01T06:00:00").getTime());

        const mockGetEarliestEvents = vi.fn().mockResolvedValue({
            // earliest event and earliest bounce are the same
            earliestEvent: new Date("2023-01-01T00:00:00Z"),
            earliestBounce: new Date("2023-01-01T00:00:00Z"),
        });

        const context = {
            analyticsEngine: {
                getCounts: mockGetCounts,
                getEarliestEvents: mockGetEarliestEvents,
            },
            cloudflare: {
                env: {
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                },
            },
        };

        const request = new Request(
            "https://example.com/resources/stats?site=test-site&interval=24h&timezone=UTC",
        );

        const response = await loader({ context, request } as any);
        const data = await response;

        expect(mockGetCounts).toHaveBeenCalledWith(
            "test-site",
            "24h",
            "UTC",
            expect.any(Object),
        );

        expect(data).toEqual({
            views: 1000,
            visitors: 250,
            bounceRate: 0.5,
            hasSufficientBounceData: true,
        });
    });

    test("if bounce data isn't complete for the given interval, hasSufficientBounceData is false", async () => {
        // set system time as jan 8th
        vi.setSystemTime(new Date("2023-01-08T00:00:00").getTime());

        const mockGetEarliestEvents = vi.fn().mockResolvedValue({
            earliestEvent: new Date("2023-01-01T00:00:00Z"),
            earliestBounce: new Date("2023-01-04T00:00:00Z"), // Jan 4
        });

        const context = {
            analyticsEngine: {
                getCounts: mockGetCounts,
                getEarliestEvents: mockGetEarliestEvents,
            },
            cloudflare: {
                env: {
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                },
            },
        };

        const request = new Request(
            // 7 day interval (specified in query string)
            "https://example.com/resources/stats?site=test-site&interval=7d&timezone=UTC",
        );

        const response = await loader({ context, request } as any);
        const data = await response;

        expect(data).toEqual({
            views: 1000,
            visitors: 250,
            bounceRate: 0.5,
            hasSufficientBounceData: false,
        });
    });

    test("if bounce data *IS* complete for the given interval, show it", async () => {
        // set system time as jan 8th
        vi.setSystemTime(new Date("2023-01-08T00:00:00").getTime());

        const mockGetEarliestEvents = vi.fn().mockResolvedValue({
            earliestEvent: new Date("2023-01-01T00:00:00Z"),
            earliestBounce: new Date("2023-01-04T00:00:00Z"), // Jan 4 -- well before Jan 8th minus 1 day interval
        });

        const context = {
            analyticsEngine: {
                getCounts: mockGetCounts,
                getEarliestEvents: mockGetEarliestEvents,
            },
            cloudflare: {
                env: {
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                },
            },
        };

        const request = new Request(
            // 1 day interval (specified in query string)
            "https://example.com/resources/stats?site=test-site&interval=1d&timezone=UTC",
        );

        const response = await loader({ context, request } as any);
        const data = await response;

        expect(data).toEqual({
            views: 1000,
            visitors: 250,
            bounceRate: 0.5,
            hasSufficientBounceData: true,
        });
    });

    test("uses durable session metrics when R2 SQL is configured", async () => {
        vi.setSystemTime(new Date("2023-01-08T00:00:00Z").getTime());
        const getSessionMetrics = vi.fn().mockResolvedValue({
            views: 980,
            visitors: 240,
            visits: 300,
            bounces: 90,
            averageVisitDuration: 82.4,
        });
        const context = {
            analyticsEngine: {
                getCounts: vi
                    .fn()
                    .mockRejectedValue(new Error("AE unavailable")),
                getEarliestEvents: vi
                    .fn()
                    .mockRejectedValue(new Error("AE unavailable")),
            },
            sessionAnalytics: { getSessionMetrics },
            cloudflare: {
                env: {
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                },
            },
        };
        const request = new Request(
            "https://example.com/resources/stats?site=test-site&interval=7d&timezone=UTC",
        );

        const data = await loader({ context, request } as any);

        expect(getSessionMetrics).toHaveBeenCalledWith(
            "test-site",
            expect.any(Date),
            expect.any(Date),
            expect.any(Object),
        );
        expect(context.analyticsEngine.getCounts).not.toHaveBeenCalled();
        expect(
            context.analyticsEngine.getEarliestEvents,
        ).not.toHaveBeenCalled();
        expect(data).toEqual({
            views: 980,
            visitors: 240,
            visits: 300,
            bounceRate: 0.3,
            averageVisitDuration: 82.4,
            hasSufficientBounceData: true,
        });
    });

    test("falls back to realtime metrics when R2 SQL fails", async () => {
        vi.setSystemTime(new Date("2023-01-08T00:00:00Z").getTime());
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const context = {
            analyticsEngine: {
                getCounts: mockGetCounts,
                getEarliestEvents: vi.fn().mockResolvedValue({
                    earliestEvent: new Date("2023-01-01T00:00:00Z"),
                    earliestBounce: new Date("2023-01-01T00:00:00Z"),
                }),
            },
            sessionAnalytics: {
                getSessionMetrics: vi.fn().mockRejectedValue(new Error("down")),
            },
            cloudflare: {
                env: {
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                },
            },
        };
        const request = new Request(
            "https://example.com/resources/stats?site=test-site&interval=1d&timezone=UTC",
        );

        const data = await loader({ context, request } as any);

        expect(data).toEqual({
            views: 1000,
            visitors: 250,
            bounceRate: 0.5,
            hasSufficientBounceData: true,
        });
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
