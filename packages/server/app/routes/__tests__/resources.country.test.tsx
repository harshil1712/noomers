// @vitest-environment jsdom
import { vi, test, describe, expect } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.country";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/country route", () => {
    describe("loader", () => {
        test("returns valid json", async () => {
            const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [{"dimension": "US", "visitors": 5, "views": 9, "events": 9, "visits": 6, "bounces": 1, "averageVisitDuration": 30}] });
            const context = contextWithAnalytics({ getSessionBreakdown });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/country?site=example.com&interval=7d",
                },
            });

            expect(getSessionBreakdown).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "visit:country",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "visits", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["US", 5, 6]],
                page: 1,
            });
        });
    });
});
