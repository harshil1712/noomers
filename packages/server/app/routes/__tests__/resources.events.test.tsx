// @vitest-environment jsdom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    Mock,
    test,
    vi,
} from "vitest";
import "vitest-dom/extend-expect";

import { loader } from "../resources.events";
import { createFetchResponse, getDefaultContext } from "./testutils";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Resources/Events route", () => {
    let fetch: Mock;

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("returns custom event counts", async () => {
        fetch.mockResolvedValueOnce(
            createFetchResponse({
                data: [
                    { eventName: "Signup", count: "12" },
                    { eventName: "Download", count: "7" },
                ],
            }),
        );

        const response = await loader({
            ...getDefaultContext(),
            // @ts-expect-error we don't need all request properties
            request: {
                url: "http://localhost:3000/resources/events?site=example.com&interval=7d",
            },
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(await response).toEqual({
            countsByProperty: [
                ["Signup", 12],
                ["Download", 7],
            ],
            page: 1,
        });
    });
});
