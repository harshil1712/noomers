// @vitest-environment jsdom
import { vi, test, describe, expect } from "vitest";
import "vitest-dom/extend-expect";

import { contextWithAnalytics } from "./testutils";
import { loader } from "../resources.events";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/events route", () => {
    describe("loader", () => {
        test("returns custom event counts", async () => {
            const getBasicMetrics = vi.fn().mockResolvedValue({ rows: [{"dimension": "Signup", "visitors": 10, "views": 0, "events": 12}, {"dimension": "Download", "visitors": 6, "views": 0, "events": 7}] });
            const context = contextWithAnalytics({ getBasicMetrics });

            const json = await loader({
                ...context,
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/events?site=example.com&interval=7d",
                },
            });

            expect(getBasicMetrics).toHaveBeenCalledWith(
                "example.com",
                expect.any(Date),
                expect.any(Date),
                {},
                "event:name",
                undefined,
                expect.objectContaining({
                    orderBy: [{ field: "events", direction: "desc" }],
                    pagination: { limit: 10, offset: 0 },
                }),
            );
            expect(json).toEqual({
                countsByProperty: [["Signup", 12], ["Download", 7]],
                page: 1,
            });
        });
    });
});
