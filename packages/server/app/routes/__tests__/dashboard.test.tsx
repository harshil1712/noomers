// @vitest-environment jsdom
import type { LoaderFunctionArgs } from "react-router";
import {
    vi,
    test,
    describe,
    beforeAll,
    beforeEach,
    afterEach,
    expect,
    Mock,
} from "vitest";
import { requireAuth } from "~/lib/auth";
import "vitest-dom/extend-expect";

import { createRoutesStub } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";

import Dashboard, { loader } from "../dashboard";

import { createFetchResponse, getDefaultContext } from "./testutils";
import ResizeObserverPolyfill from "resize-observer-polyfill";

const { listSites } = vi.hoisted(() => ({
    listSites: vi.fn(),
}));

vi.mock("~/sites/repository", () => ({
    SitesRepository: vi.fn(function () {
        return { list: listSites };
    }),
}));

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

describe("Dashboard route", () => {
    let fetch: Mock;

    beforeAll(() => {
        // polyfill needed for recharts (used by TimeSeriesChart)
        global.ResizeObserver = ResizeObserverPolyfill;
    });

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
        vi.mocked(requireAuth).mockResolvedValue({} as any);
        listSites.mockResolvedValue({ sites: [] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("loader", () => {
        test("throws a 501 Response if no Cloudflare credentials are provided", async () => {
            const mockLoaderParams: LoaderFunctionArgs = {
                context: {
                    basinConfigured: true,
                    cloudflare: {
                        env: {
                            CF_ACCOUNT_ID: "",
                        },
                    },
                },
                // @ts-expect-error we don't need to provide all the properties of the cloudflare object
                request: {
                    url: "http://localhost:3000/dashboard",
                },
            };

            try {
                await loader(mockLoaderParams);
            } catch (error) {
                expect(error).toBeInstanceOf(Response);
                const response = error as Response;
                expect(await response.text()).toBe(
                    "Missing credentials: CF_ACCOUNT_ID is not set.",
                );
                expect(response.status).toBe(501);
            }

            // run it again with account ID present but Basin unconfigured
            mockLoaderParams.context = {
                basinConfigured: false,
                cloudflare: {
                    env: {
                        CF_ACCOUNT_ID: "testAccountId",
                    },
                },
            } as never;

            try {
                await loader(mockLoaderParams);
            } catch (error) {
                expect(error).toBeInstanceOf(Response);
                const response = error as Response;
                expect(await response.text()).toContain(
                    "Basin SQL is not configured",
                );
                expect(response.status).toBe(501);
            }
        });

        test("redirects to ?site=siteId if no siteId is provided via query string", async () => {
            listSites.mockResolvedValueOnce({
                sites: [{ domain: "test-siteid" }],
            });

            try {
                await loader({
                    ...getDefaultContext(),
                    // @ts-expect-error we don't need to provide all the properties of the request object
                    request: {
                        url: "http://localhost:3000/dashboard", // no site query param
                    },
                });
            } catch (error) {
                expect(error).toBeInstanceOf(Response);
                const response = error as Response;

                // expect redirect
                expect(response.status).toBe(302);
                expect(response.headers.get("Location")).toBe(
                    "http://localhost:3000/dashboard?site=test-siteid",
                );
            }
        });

        test("redirects to a registered site when it has no Analytics Engine data", async () => {
            // response for getSitesByOrderedHits
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [],
                }),
            );
            listSites.mockResolvedValueOnce({
                sites: [{ domain: "registered.example" }],
            });

            try {
                await loader({
                    ...getDefaultContext(),
                    // @ts-expect-error we don't need to provide all the properties of the request object
                    request: {
                        url: "http://localhost:3000/dashboard", // no site query param
                    },
                });
            } catch (error) {
                expect(error).toBeInstanceOf(Response);
                const response = error as Response;

                // expect redirect
                expect(response.status).toBe(302);
                expect(response.headers.get("Location")).toBe(
                    "http://localhost:3000/dashboard?site=registered.example",
                );
            }
        });

        test("assembles data returned from CF API", async () => {
            // response for getSitesByOrderedHits
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [{ siteId: "test-siteid", count: 1 }],
                }),
            );
            listSites.mockResolvedValueOnce({
                sites: [{ domain: "registered.example" }],
            });

            vi.setSystemTime(new Date("2024-01-18T09:33:02").getTime());

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/dashboard?site=test-siteid",
                },
            });

            const json = await response;

            expect(json).toEqual({
                filters: {},
                siteId: "test-siteid",
                sites: ["registered.example"],
                intervalType: "DAY",
                interval: "7d",
            });
        });

        test("returns a valid empty result set when no data (no sites, no anything)", async () => {
            vi.setSystemTime(new Date("2024-01-18T09:33:02").getTime());

            fetch.mockResolvedValueOnce(createFetchResponse({ data: [] })); // getSitesOrderedByHits
            fetch.mockResolvedValueOnce(createFetchResponse({ data: [] })); // get counts
            fetch.mockResolvedValueOnce(createFetchResponse({ data: [] })); // getViewsGroupedByInterval

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/dashboard?site=", // intentionally empty
                },
            });

            const json = await response;

            expect(json).toEqual({
                filters: {},
                siteId: "",
                sites: [],
                intervalType: "DAY",
                interval: "7d",
            });
        });
    });

    test("renders when no data", async () => {
        function loader() {
            return {
                siteId: "@unknown",
                sites: [],
                intervalType: "day",
            };
        }

        const RemixStub = createRoutesStub([
            {
                path: "/",
                Component: Dashboard,
                loader,
                children: [
                    {
                        path: "/resources/timeseries",
                        loader: () => {
                            return { chartData: [] };
                        },
                    },
                    {
                        path: "/resources/stats",
                        loader: () => {
                            return {
                                views: 0,
                                visitors: 0,
                            };
                        },
                    },
                    {
                        path: "/resources/paths",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/referrer",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/events",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/goals",
                        loader: () => ({ goals: [] }),
                    },
                    {
                        path: "/resources/browser",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/country",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/device",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/browserversion",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-source",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-medium",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-campaign",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-term",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-content",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                ],
            },
        ]);

        render(<RemixStub />);

        await waitFor(() => screen.findByText("Path"));
        expect(screen.getByText("Path")).toBeInTheDocument();
        expect(screen.getByText("Referrer")).toBeInTheDocument();
        expect(screen.getAllByText("Event").length).toBeGreaterThan(0);
        expect(screen.getByText("Goals")).toBeInTheDocument();
        expect(screen.getByText("Browser")).toBeInTheDocument();
        expect(screen.getByText("Country")).toBeInTheDocument();
        expect(screen.getByText("Device")).toBeInTheDocument();
        expect(screen.getByText("UTM Source")).toBeInTheDocument();
        expect(screen.getByText("UTM Medium")).toBeInTheDocument();
        expect(screen.getByText("UTM Campaign")).toBeInTheDocument();
        expect(screen.getByText("UTM Term")).toBeInTheDocument();
        expect(screen.getByText("UTM Content")).toBeInTheDocument();
    });

    const defaultMockedLoaderJson = {
        siteId: "example",
        sites: ["example"],
        views: 2133,
        visitors: 33,
        viewsGroupedByInterval: [
            ["2024-01-11 05:00:00", 0],
            ["2024-01-12 05:00:00", 0],
            ["2024-01-13 05:00:00", 3],
            ["2024-01-14 05:00:00", 0],
            ["2024-01-15 05:00:00", 0],
            ["2024-01-16 05:00:00", 2],
            ["2024-01-17 05:00:00", 1],
            ["2024-01-18 05:00:00", 0],
        ],
        intervalType: "day",
        filters: {
            path: "/lol",
        },
    };

    test("renders with valid data", async () => {
        function loader() {
            return {
                ...defaultMockedLoaderJson,
            };
        }

        const RemixStub = createRoutesStub([
            {
                path: "/",
                Component: Dashboard,
                loader,
                children: [
                    {
                        path: "/resources/stats",
                        loader: () => {
                            return {
                                views: 2133,
                                visitors: 33,
                                visits: 40,
                                averageVisitDuration: 82,
                                bounceRate: 0.3,
                                hasSufficientBounceData: true,
                            };
                        },
                    },
                    {
                        path: "/resources/timeseries",
                        loader: () => {
                            return {};
                        },
                    },
                    {
                        path: "/resources/paths",
                        loader: () => {
                            return {
                                countsByProperty: [
                                    ["/", 100],
                                    ["/about", 80],
                                    ["/contact", 60],
                                ],
                            };
                        },
                    },
                    {
                        path: "/resources/referrer",
                        loader: () => {
                            return {
                                countsByProperty: [
                                    ["google.com", 100],
                                    ["facebook.com", 80],
                                    ["twitter.com", 60],
                                ],
                            };
                        },
                    },
                    {
                        path: "/resources/events",
                        loader: () => {
                            return {
                                countsByProperty: [["Signup", 12]],
                            };
                        },
                    },
                    {
                        path: "/resources/goals",
                        loader: () => ({
                            goals: [
                                {
                                    id: "goal-1",
                                    siteId: "example",
                                    name: "Signup conversion",
                                    type: "event",
                                    value: "Signup",
                                    createdAt: "2026-08-02T00:00:00Z",
                                    conversions: 12,
                                    conversionRate: 4.2,
                                },
                            ],
                        }),
                    },
                    {
                        path: "/resources/browser",
                        loader: () => {
                            return {
                                countsByProperty: [
                                    ["Chrome", 100],
                                    ["Safari", 80],
                                    ["Firefox", 60],
                                ],
                            };
                        },
                    },
                    {
                        path: "/resources/country",
                        loader: () => {
                            return {
                                countsByProperty: [
                                    ["United States", 100],
                                    ["Canada", 80],
                                    ["United Kingdom", 60],
                                ],
                            };
                        },
                    },
                    {
                        path: "/resources/device",
                        loader: () => {
                            return {
                                countsByProperty: [
                                    ["Desktop", 100],
                                    ["Mobile", 80],
                                    ["Tablet", 60],
                                ],
                            };
                        },
                    },
                    {
                        path: "/resources/browserversion",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-source",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-medium",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-campaign",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-term",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                    {
                        path: "/resources/utm-content",
                        loader: () => {
                            return { countsByProperty: [] };
                        },
                    },
                ],
            },
        ]);

        render(<RemixStub />);

        // wait until the rows render in the document
        await waitFor(() => screen.findByText("Chrome"), {
            // increased timeout because this test was failing on slower environments, e.g. GitHub actions
            timeout: 5_000,
        });

        // assert some of the data we mocked actually rendered into the document
        expect(screen.getByText("2.1K")).toBeInTheDocument(); // view count
        expect(screen.getByText("33")).toBeInTheDocument(); // visitor count
        expect(screen.getByText("40")).toBeInTheDocument(); // visit count
        expect(screen.getByText("1m 22s")).toBeInTheDocument();
        expect(screen.getByText("30%")).toBeInTheDocument();

        expect(screen.getByText("/about")).toBeInTheDocument();
        expect(screen.getByText("Chrome")).toBeInTheDocument();
        expect(screen.getByText("google.com")).toBeInTheDocument();
        expect(screen.getByText("Signup")).toBeInTheDocument();
        expect(screen.getByText("Signup conversion")).toBeInTheDocument();
        expect(screen.getByText("Canada")).toBeInTheDocument(); // assert converted CA -> Canada
        expect(screen.getByText("Mobile")).toBeInTheDocument();
    });
});
