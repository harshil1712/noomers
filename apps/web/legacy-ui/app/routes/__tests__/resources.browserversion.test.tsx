// @vitest-environment jsdom
import { vi, test, describe, expect } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.browserversion";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/browserversion route", () => {
    describe("loader", () => {
        test("returns valid json", async () => {
            const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [{"dimension": "120.x", "visitors": 2, "views": 3, "events": 3, "visits": 2, "bounces": 0, "averageVisitDuration": 15}] });
            const context = contextWithAnalytics({ getSessionBreakdown });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/browserversion?site=example.com&interval=7d",
                },
            });

            expect(getSessionBreakdown).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "visit:browser_version",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "visits", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["120.x", 2, 2]],
                page: 1,
            });
        });
    });
});
