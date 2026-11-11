import { describe, test, expect, beforeAll, afterEach, vi } from "vitest";

import * as noomers from "../index";
import * as requestModule from "../lib/request";
import { Client } from "~/lib/client";

describe("api", () => {
    let fetchCalls: [string | URL | Request, RequestInit | undefined][] = [];
    beforeAll(() => {
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string | URL | Request, init?: RequestInit) => {
                fetchCalls.push([url, init]);
                return Promise.resolve(new Response());
            }),
        );

        // Mock the checkCacheStatus function to return a default response
        vi.spyOn(requestModule, "checkCacheStatus").mockImplementation(() => {
            return Promise.resolve({
                ht: 1, // First hit (new visit)
            });
        });
    });

    afterEach(() => {
        fetchCalls = [];
        noomers.cleanup();
    });

    describe("init", () => {
        test("initializes", () => {
            noomers.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });
        });
        test("does not error when init is called twice", () => {
            expect(() => {
                noomers.init({
                    siteId: "test-id",
                    reporterUrl: "https://example.com/collect",
                    autoTrackPageviews: false,
                });
                noomers.init({
                    siteId: "test-id",
                    reporterUrl: "https://example.com/collect",
                    autoTrackPageviews: false,
                });
            }).not.toThrow();
        });
    });

    describe("isInitialized", () => {
        test("returns true when init has been called", () => {
            noomers.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });
            expect(noomers.isInitialized()).toBe(true);
        });
        test("returns false when init has not been called", () => {
            expect(noomers.isInitialized()).toBe(false);
        });
    });

    describe("getInitializedClient", () => {
        test("returns an instance of a client if called after init", () => {
            noomers.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            expect(noomers.getInitializedClient()).toBeInstanceOf(Client);
        });

        test("returns undefined if called without init", () => {
            expect(noomers.getInitializedClient()).toBeUndefined();
        });
    });

    describe("trackPageview", () => {
        test("records a pageview for the current url", async () => {
            noomers.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(fetchCalls).toHaveLength(0);

            await noomers.trackPageview();

            expect(fetchCalls).toHaveLength(1);

            expect(fetchCalls[0][1]?.method).toBe("GET");

            const searchParams = new URL(String(fetchCalls[0][0])).searchParams;
            expect(searchParams.get("sid")).toBe("test-id");
            expect(searchParams.get("h")).toBe("http://localhost");
            expect(searchParams.get("p")).toBe("/"); // default path when running test w/ jsdom
            expect(searchParams.get("r")).toBe("");
            expect(searchParams.get("ht")).toBe("1"); // First hit (new visit)
        });

        test("records a pageview for the given url and referrer", async () => {
            noomers.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(fetchCalls).toHaveLength(0);

            await noomers.trackPageview({
                url: "https://example.com/foo",
                referrer: "https://referrer.com/",
            });

            expect(fetchCalls).toHaveLength(1);

            expect(fetchCalls[0][1]?.method).toBe("GET");

            const searchParams = new URL(String(fetchCalls[0][0])).searchParams;
            expect(searchParams.get("sid")).toBe("test-id");
            expect(searchParams.get("h")).toBe("https://example.com");
            expect(searchParams.get("p")).toBe("/foo");
            expect(searchParams.get("r")).toBe("https://referrer.com/");
            expect(searchParams.get("ht")).toBe("1"); // First hit (new visit)
        });
    });

    describe("autoTrackPageviews", () => {
        test("initializes with autoTrackPageviews", async () => {
            // Initialize with autoTrackPageviews: true
            noomers.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: true,
            });

            // Wait for setTimeout in the Client constructor to execute
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Check that at least one XHR request was made (initial pageview)
            expect(fetchCalls.length).toBeGreaterThan(0);

            // Trigger a navigation event
            window.dispatchEvent(new Event("popstate"));

            // Wait for the navigation event to be processed
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Check that another XHR request was made (after navigation)
            const initialCount = fetchCalls.length;
            expect(initialCount).toBeGreaterThan(1);

            // Trigger another navigation event
            window.history.pushState({}, "", "/another-page");
            window.dispatchEvent(new Event("popstate"));

            // Wait for the second navigation event to be processed
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Check that a third XHR request was made
            expect(fetchCalls.length).toBeGreaterThan(initialCount);
        });
    });

    describe("reportOnLocalhost", () => {
        test("should not report on localhost by default", async () => {
            noomers.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(fetchCalls).toHaveLength(0);

            await noomers.trackPageview({
                url: "https://example.com/foo",
                referrer: "https://referrer.com/",
            });

            expect(fetchCalls).toHaveLength(0);
        });

        test("should report on localhost when reportOnLocalhost is set to true", async () => {
            noomers.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(fetchCalls).toHaveLength(0);

            await noomers.trackPageview({
                url: "https://example.com/foo",
                referrer: "https://referrer.com/",
            });

            expect(fetchCalls).toHaveLength(1);
        });
    });

    describe("autoTrackOutboundLinks", () => {
        afterEach(() => {
            document.body.innerHTML = "";
        });

        function initOutbound(autoTrackOutboundLinks?: boolean) {
            noomers.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
                autoTrackOutboundLinks,
            });
        }

        function link(href: string) {
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.innerHTML = "<span>go</span>";
            anchor.addEventListener("click", (event) => event.preventDefault());
            document.body.appendChild(anchor);
            return anchor;
        }

        function sentEvents() {
            return fetchCalls.map(
                ([, init]) => new URLSearchParams(String(init?.body)),
            );
        }

        test("tracks external link clicks without query or fragment", () => {
            initOutbound(true);

            link("https://other.example/path/page?secret=1#top").click();

            const events = sentEvents();
            expect(events).toHaveLength(1);
            expect(events[0].get("en")).toBe("Outbound Link: Click");
            expect(events[0].get("ep")).toBe(
                JSON.stringify({ url: "https://other.example/path/page" }),
            );
        });

        test("ignores same-host and non-http links", () => {
            initOutbound(true);

            link(`${location.origin}/internal`).click();
            link("mailto:hi@example.com").click();

            expect(fetchCalls).toHaveLength(0);
        });

        test("tracks clicks on elements inside the link", () => {
            initOutbound(true);

            link("https://other.example/")
                .querySelector("span")
                ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

            expect(sentEvents()[0]?.get("en")).toBe("Outbound Link: Click");
        });

        test("tracks middle-button auxclick only", () => {
            initOutbound(true);
            const anchor = link("https://other.example/");

            anchor.dispatchEvent(
                new MouseEvent("auxclick", { bubbles: true, button: 2 }),
            );
            expect(fetchCalls).toHaveLength(0);

            anchor.dispatchEvent(
                new MouseEvent("auxclick", { bubbles: true, button: 1 }),
            );
            expect(sentEvents()[0]?.get("en")).toBe("Outbound Link: Click");
        });

        test("is off unless enabled", () => {
            initOutbound();

            link("https://other.example/").click();

            expect(fetchCalls).toHaveLength(0);
        });

        test("stops tracking after cleanup", () => {
            initOutbound(true);
            noomers.cleanup();
            fetchCalls = [];

            link("https://other.example/").click();

            expect(fetchCalls).toHaveLength(0);
        });
    });
});
