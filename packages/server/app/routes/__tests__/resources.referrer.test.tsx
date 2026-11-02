// @vitest-environment jsdom
import { vi, test, describe, expect, beforeEach } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.referrer";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/referrer route", () => {
    describe("loader", () => {
        test("returns valid json", async () => {
            const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [{"dimension": "/example", "visitors": 1, "views": 3, "events": 3, "visits": 3, "bounces": 0, "averageVisitDuration": 10}] });
            const context = contextWithAnalytics({ getSessionBreakdown });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/referrer?site=example.com&interval=7d",
                },
            });

            expect(getSessionBreakdown).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "visit:referrer",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "visits", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["/example", 1, 3]],
                page: 1,
            });
        });
    });
});
