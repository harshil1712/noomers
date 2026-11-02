// @vitest-environment jsdom
import { vi, test, describe, expect, beforeEach } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.device";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/device route", () => {
    describe("loader", () => {
        test("returns valid json", async () => {
            const getSessionBreakdown = vi.fn().mockResolvedValue({ rows: [{"dimension": "desktop", "visitors": 4, "views": 6, "events": 6, "visits": 5, "bounces": 0, "averageVisitDuration": 40}] });
            const context = contextWithAnalytics({ getSessionBreakdown });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/device?site=example.com&interval=7d",
                },
            });

            expect(getSessionBreakdown).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "visit:device_type",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "visits", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["desktop", 4, 5]],
                page: 1,
            });
        });
    });
});
