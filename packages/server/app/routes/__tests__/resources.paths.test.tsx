// @vitest-environment jsdom
import { vi, test, describe, expect, beforeEach } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.paths";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/paths route", () => {
    describe("loader", () => {
        test("returns valid json", async () => {
            const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [{"dimension": "/example", "visitors": 4, "views": 10, "events": 10}, {"dimension": "/", "visitors": 2, "views": 7, "events": 7}] });
            const context = contextWithAnalytics({ getBasicMetrics });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/paths?site=example.com&interval=7d",
                },
            });

            expect(getBasicMetrics).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "event:page",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "pageviews", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["/example", 4, 10], ["/", 2, 7]],
                page: 1,
            });
        });
    });
});
