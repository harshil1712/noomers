// @vitest-environment jsdom
import { vi, test, describe, expect } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.utm-medium";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/utm-medium route", () => {
    describe("loader", () => {
        test("returns valid json with UTM medium data", async () => {
            const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [{"dimension": "search", "visitors": 8, "views": 9, "events": 9, "visits": 8, "bounces": 2, "averageVisitDuration": 50}] });
            const context = contextWithAnalytics({ getSessionBreakdown });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/utm-medium?site=example.com&interval=7d",
                },
            });

            expect(getSessionBreakdown).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "visit:utm_medium",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "visits", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["search", 8, 8]],
                page: 1,
            });
        });
    });
});
