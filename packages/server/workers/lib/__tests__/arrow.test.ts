import { beforeEach, describe, expect, test, vi } from "vitest";

import { extractAsArrow } from "../arrow";

const { AnalyticsEngineAPI } = vi.hoisted(() => ({
    AnalyticsEngineAPI: vi.fn(),
}));

vi.mock("../../../app/analytics/query", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../../../app/analytics/query")>();
    return {
        ...actual,
        AnalyticsEngineAPI,
    };
});

function createBucket(): {
    put: ReturnType<typeof vi.fn>;
    head: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
} {
    return {
        put: vi.fn().mockResolvedValue(undefined),
        head: vi.fn().mockResolvedValue(null),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
    };
}

function createApiMock(
    data: Map<
        string[],
        { views: number; visitors: number; bounces: number; events?: number }
    >,
) {
    const getAllCountsByAllColumnsForAllSites = vi.fn().mockResolvedValue(data);
    AnalyticsEngineAPI.mockImplementation(function () {
        return { getAllCountsByAllColumnsForAllSites };
    });
    return getAllCountsByAllColumnsForAllSites;
}

describe("extractAsArrow", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-01-18T09:33:02Z"));
        AnalyticsEngineAPI.mockClear();
    });

    test("queries the exact UTC half-open previous-day interval", async () => {
        const getAllCounts = createApiMock(new Map());
        const bucket = createBucket();

        await extractAsArrow(
            { accountId: "acct", bearerToken: "token" },
            bucket as never,
        );

        expect(getAllCounts).toHaveBeenCalledTimes(1);
        const [columns, startDateTime, endDateTime] =
            getAllCounts.mock.calls[0];
        expect(startDateTime.toISOString()).toBe("2024-01-17T00:00:00.000Z");
        expect(endDateTime.toISOString()).toBe("2024-01-18T00:00:00.000Z");
        expect(columns).not.toContain("siteId");
        expect(columns).not.toContain("visitorId");
        expect(columns).not.toContain("eventProperties");
    });

    test("writes files named for the UTC previous day", async () => {
        createApiMock(
            new Map([
                [
                    ["2024-01-17 12:00:00", "example.com", "Signup"],
                    { views: 2, visitors: 1, bounces: 1, events: 2 },
                ],
            ]),
        );
        const bucket = createBucket();

        const result = await extractAsArrow(
            { accountId: "acct", bearerToken: "token" },
            bucket as never,
        );

        expect(bucket.put).toHaveBeenCalledTimes(1);
        const [filename] = bucket.put.mock.calls[0];
        expect(filename).toBe("sites/example.com/analytics-2024-01-17.arrow");
        expect(result.recordCount).toBe(1);
        expect(result.filenames).toEqual([
            "sites/example.com/analytics-2024-01-17.arrow",
        ]);
    });
});
