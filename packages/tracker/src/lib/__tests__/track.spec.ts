import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { trackEvent, trackPageview } from "../track";
import * as requestModule from "../request";
import * as engagementModule from "../engagement";
import { Client } from "../client";

describe("trackPageview", () => {
    // Mock the makeRequest function
    const makeRequestMock = vi.fn();

    beforeEach(() => {
        // Mock the makeRequest function
        vi.spyOn(requestModule, "makeRequest").mockImplementation(
            makeRequestMock,
        );

        // Mock the checkCacheStatus function to return a default response
        vi.spyOn(requestModule, "checkCacheStatus").mockImplementation(() => {
            return Promise.resolve({
                ht: 1, // First hit (new visit)
            });
        });

        // Reset mocks between tests
        makeRequestMock.mockReset();

        // Mock window.location
        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/test-path",
                search: "?test=true",
                host: "example.com",
            },
        });

        // Mock navigator.userAgent
        Object.defineProperty(navigator, "userAgent", {
            writable: true,
            value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        });

        // Mock document.referrer
        Object.defineProperty(document, "referrer", {
            writable: true,
            value: "",
        });

        // Mock document.querySelector for canonical URL
        vi.spyOn(document, "querySelector").mockReturnValue(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        vi.spyOn(performance, "now").mockReturnValue(0);
        Object.defineProperty(document, "visibilityState", {
            writable: true,
            configurable: true,
            value: "visible",
        });
    });

    test("should make a request when host is not empty", async () => {
        const client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
        });

        await trackPageview(client);

        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        expect(makeRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                p: "/test-path",
                h: "http://localhost",
                r: "",
                sid: "test-site",
                ht: "1", // First hit (new visit)
            }),
        );
    });

    test("should track a custom event with typed properties", async () => {
        const client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
        });

        await trackEvent(client, " Signup ", {
            props: { plan: "pro", seats: 3, trial: true },
        });

        expect(makeRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                sid: "test-site",
                en: "Signup",
                ep: JSON.stringify({ plan: "pro", seats: 3, trial: true }),
            }),
        );
    });

    test("should exit early when host is empty and not in Electron", async () => {
        // Mock empty host (file:/// URI)
        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/test-path",
                search: "?test=true",
                host: "",
            },
        });

        // Mock non-Electron user agent
        Object.defineProperty(navigator, "userAgent", {
            writable: true,
            value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        });

        const client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
        });

        await trackPageview(client);

        // Verify that makeRequest was not called
        expect(makeRequestMock).not.toHaveBeenCalled();
    });

    test("should make a request when host is empty but in Electron", async () => {
        // Mock empty host (file:/// URI)
        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/test-path",
                search: "?test=true",
                host: "",
            },
        });

        // Mock Electron user agent
        Object.defineProperty(navigator, "userAgent", {
            writable: true,
            value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/15.0.0",
        });

        const client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
        });

        await trackPageview(client);

        // Verify that makeRequest was called
        expect(makeRequestMock).toHaveBeenCalledTimes(1);
    });

    test("should not make a request on localhost when reportOnLocalhost is false", async () => {
        // Mock localhost hostname
        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/test-path",
                search: "?test=true",
                host: "localhost:3000",
                hostname: "localhost",
            },
        });

        const client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
            reportOnLocalhost: false,
        });

        await trackPageview(client);

        // Verify that makeRequest was not called
        expect(makeRequestMock).not.toHaveBeenCalled();
    });

    test("should make a request on localhost when reportOnLocalhost is true", async () => {
        // Mock localhost hostname
        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/test-path",
                search: "?test=true",
                host: "localhost:3000",
                hostname: "localhost",
            },
        });

        const client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
            reportOnLocalhost: true,
        });

        await trackPageview(client);

        // Verify that makeRequest was called
        expect(makeRequestMock).toHaveBeenCalledTimes(1);
    });

    describe("localhost detection", () => {
        test.each([
            "localhost",
            "127.0.0.1",
            "127.1",
            "127.0.1",
            "::1",
            "0:0:0:0:0:0:0:1",
        ])(
            "should not track on %s when reportOnLocalhost is false",
            async (hostname) => {
                // Mock localhost-like hostname
                Object.defineProperty(window, "location", {
                    writable: true,
                    value: {
                        pathname: "/test-path",
                        search: "?test=true",
                        host: hostname,
                        hostname: hostname,
                    },
                });

                const client = new Client({
                    siteId: "test-site",
                    reporterUrl: "https://example.com/collect",
                    autoTrackPageviews: false,
                    reportOnLocalhost: false,
                });

                await trackPageview(client);

                expect(makeRequestMock).not.toHaveBeenCalled();
            },
        );

        test.each([
            "localhost",
            "127.0.0.1",
            "127.1",
            "127.0.1",
            "::1",
            "0:0:0:0:0:0:0:1",
        ])(
            "should track on %s when reportOnLocalhost is true",
            async (hostname) => {
                // Mock localhost-like hostname
                Object.defineProperty(window, "location", {
                    writable: true,
                    value: {
                        pathname: "/test-path",
                        search: "?test=true",
                        host: hostname,
                        hostname: hostname,
                    },
                });

                const client = new Client({
                    siteId: "test-site",
                    reporterUrl: "https://example.com/collect",
                    autoTrackPageviews: false,
                    reportOnLocalhost: true,
                });

                await trackPageview(client);

                expect(makeRequestMock).toHaveBeenCalledTimes(1);
            },
        );
    });

    describe("UTM parameter tracking", () => {
        test("should include UTM parameters when present in URL", async () => {
            // Mock location with UTM parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale&utm_term=analytics&utm_content=banner",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    p: "/test-path",
                    h: "http://localhost",
                    r: "google",
                    sid: "test-site",
                    ht: "1",
                    us: "google",
                    um: "cpc",
                    uc: "summer_sale",
                    ut: "analytics",
                    uco: "banner",
                }),
            );
        });

        test("should include only non-empty UTM parameters", async () => {
            // Mock location with partial UTM parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?utm_source=google&utm_medium=&utm_campaign=summer_sale",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            const callArgs = makeRequestMock.mock.calls[0][1];
            expect(callArgs).toHaveProperty("us", "google");
            expect(callArgs).toHaveProperty("uc", "summer_sale");
            expect(callArgs).not.toHaveProperty("um");
            expect(callArgs).not.toHaveProperty("ut");
            expect(callArgs).not.toHaveProperty("uco");
        });

        test("should work without UTM parameters (backwards compatibility)", async () => {
            // Mock location without UTM parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?regular=param",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            const callArgs = makeRequestMock.mock.calls[0][1];
            expect(callArgs).toHaveProperty("p", "/test-path");
            expect(callArgs).toHaveProperty("h", "http://localhost");
            expect(callArgs).toHaveProperty("r", "");
            expect(callArgs).toHaveProperty("sid", "test-site");
            expect(callArgs).toHaveProperty("ht", "1");
            expect(callArgs).not.toHaveProperty("us");
            expect(callArgs).not.toHaveProperty("um");
            expect(callArgs).not.toHaveProperty("uc");
            expect(callArgs).not.toHaveProperty("ut");
            expect(callArgs).not.toHaveProperty("uco");
        });

        test("should handle custom URL with UTM parameters", async () => {
            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client, {
                url: "/custom-path?utm_source=newsletter&utm_medium=email",
            });

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            const callArgs = makeRequestMock.mock.calls[0][1];
            expect(callArgs).toHaveProperty("us", "newsletter");
            expect(callArgs).toHaveProperty("um", "email");
            expect(callArgs).not.toHaveProperty("uc");
            expect(callArgs).not.toHaveProperty("ut");
            expect(callArgs).not.toHaveProperty("uco");
        });

        test("should handle URL-encoded UTM parameters", async () => {
            // Mock location with URL-encoded UTM parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?utm_campaign=summer%20sale&utm_content=blue%20button",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            const callArgs = makeRequestMock.mock.calls[0][1];
            expect(callArgs).toHaveProperty("uc", "summer sale");
            expect(callArgs).toHaveProperty("uco", "blue button");
        });

        test("should handle mixed UTM and non-UTM parameters", async () => {
            // Mock location with mixed parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?page=1&utm_source=twitter&sort=date&utm_campaign=launch",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            const callArgs = makeRequestMock.mock.calls[0][1];
            expect(callArgs).toHaveProperty("us", "twitter");
            expect(callArgs).toHaveProperty("uc", "launch");
            expect(callArgs).not.toHaveProperty("um");
            expect(callArgs).not.toHaveProperty("ut");
            expect(callArgs).not.toHaveProperty("uco");
        });
    });

    describe("engagement lifecycle integration", () => {
        test("starts an engagement context after tracking a pageview", async () => {
            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            const startEngagementSpy = vi.spyOn(
                engagementModule,
                "startEngagement",
            );

            await trackPageview(client);

            expect(startEngagementSpy).toHaveBeenCalledWith(
                client,
                "http://localhost",
                "/test-path",
                "",
            );

            client.cleanup();
        });

        test("flushes previous engagement before SPA navigation", async () => {
            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            vi.spyOn(performance, "now").mockImplementation(() => 5000);
            Object.defineProperty(document, "visibilityState", {
                writable: true,
                configurable: true,
                value: "visible",
            });

            await trackPageview(client, { url: "/first" });

            vi.spyOn(performance, "now").mockImplementation(() => 8000);

            await trackPageview(client, { url: "/second" });

            // First call should be the first pageview; second call is engagement
            // for /first; third call is the second pageview.
            const engagementCalls = makeRequestMock.mock.calls.filter(
                ([, params]) => params.et === "engagement",
            );
            expect(engagementCalls).toHaveLength(1);
            expect(engagementCalls[0][1]).toMatchObject({
                et: "engagement",
                e: "3000",
                p: "/first",
            });

            client.cleanup();
        });
    });

    describe("referrer query parameter tracking", () => {
        test("should use ref parameter when document.referrer is missing", async () => {
            // Mock location with ref parameter
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?ref=external-site.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "external-site.com",
                }),
            );
        });

        test("should use referer parameter when document.referrer is missing", async () => {
            // Mock location with referer parameter
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?referer=external-site.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "external-site.com",
                }),
            );
        });

        test("should use referrer parameter when document.referrer is missing", async () => {
            // Mock location with referrer parameter
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?referrer=external-site.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "external-site.com",
                }),
            );
        });

        test("should use source parameter when document.referrer is missing", async () => {
            // Mock location with source parameter
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?source=external-site.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "external-site.com",
                }),
            );
        });

        test("should use utm_source parameter when document.referrer is missing", async () => {
            // Mock location with utm_source parameter
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?utm_source=external-site.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "external-site.com",
                }),
            );
        });

        test("should prioritize first matching referrer parameter in order", async () => {
            // Mock location with multiple referrer parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?utm_source=second.com&ref=first.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "first.com", // Should use 'ref' since it comes first in the priority list
                }),
            );
        });

        test("should prefer document.referrer over query parameters", async () => {
            // Mock document.referrer and location with ref parameter
            Object.defineProperty(document, "referrer", {
                writable: true,
                value: "https://document-referrer.com",
            });

            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?ref=query-referrer.com",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "https://document-referrer.com", // Should use document.referrer
                }),
            );
        });

        test("should handle empty referrer query parameters", async () => {
            // Mock location with empty referrer parameters
            Object.defineProperty(window, "location", {
                writable: true,
                value: {
                    pathname: "/test-path",
                    search: "?ref=&referer=&referrer=&source=&utm_source=",
                    host: "example.com",
                },
            });

            const client = new Client({
                siteId: "test-site",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            await trackPageview(client);

            expect(makeRequestMock).toHaveBeenCalledTimes(1);
            expect(makeRequestMock).toHaveBeenCalledWith(
                "https://example.com/collect",
                expect.objectContaining({
                    r: "", // Should be empty when all parameters are empty
                }),
            );
        });
    });
});

describe("pending pageview on unload", () => {
    const makeRequestMock = vi.fn();
    let client: Client;

    beforeEach(() => {
        client = new Client({
            siteId: "example.com",
            reporterUrl: "https://a.test/collect",
            auto: false,
            reportOnLocalhost: true,
        } as never);
        vi.spyOn(requestModule, "makeRequest").mockImplementation(makeRequestMock);
        makeRequestMock.mockReset();
        vi.spyOn(document, "querySelector").mockReturnValue(null);
        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/test-path",
                search: "",
                host: "example.com",
                hostname: "example.com",
            },
        });
        Object.defineProperty(document, "referrer", { writable: true, value: "" });
    });

    afterEach(async () => {
        const { flushPendingPageview } = await import("../track");
        flushPendingPageview();
        makeRequestMock.mockReset();
    });

    test("cache resolves first → one pageview with returned ht", async () => {
        vi.spyOn(requestModule, "checkCacheStatus").mockResolvedValue({ ht: 2 } as never);
        const { flushPendingPageview } = await import("../track");
        await trackPageview(client);
        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        flushPendingPageview();
        expect(makeRequestMock).toHaveBeenCalledTimes(1);
    });

    test("flush while /cache pending → sends ht=1 once, not again on resolve", async () => {
        vi.spyOn(requestModule, "checkCacheStatus").mockImplementation(
            () => new Promise(() => {}) as never,
        );
        const { flushPendingPageview } = await import("../track");
        const p = trackPageview(client);
        await Promise.resolve();
        flushPendingPageview();
        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        expect(makeRequestMock.mock.calls[0][1]).toMatchObject({ ht: "1" });
        // Pending was cleared — a later resolve sends nothing more.
        flushPendingPageview();
        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        void p;
    });

    test("pagehide issues the pageview fetch before the engagement request", async () => {
        const { instrumentEngagementLifecycle } = await import("../instrument");
        vi.spyOn(requestModule, "checkCacheStatus").mockImplementation(
            () => new Promise(() => {}) as never,
        );
        const lifecycleMock = vi.fn();
        vi.spyOn(requestModule, "sendLifecycleRequest").mockImplementation(
            lifecycleMock as typeof requestModule.sendLifecycleRequest,
        );
        instrumentEngagementLifecycle(client);
        void trackPageview(client);
        await Promise.resolve();
        window.dispatchEvent(new Event("pagehide"));
        expect(makeRequestMock).toHaveBeenCalled();
        expect(
            makeRequestMock.mock.invocationCallOrder[0],
        ).toBeLessThan(lifecycleMock.mock.invocationCallOrder[0] ?? Infinity);
    });

    test("second trackPageview flushes the first, then sends its own", async () => {
        vi.spyOn(requestModule, "checkCacheStatus").mockImplementation(
            () => new Promise(() => {}) as never,
        );
        const p1 = trackPageview(client);
        await Promise.resolve();
        const p2 = trackPageview(client);
        await Promise.resolve();
        const { flushPendingPageview } = await import("../track");
        flushPendingPageview();
        expect(makeRequestMock).toHaveBeenCalledTimes(2);
        void p1;
        void p2;
    });
});
