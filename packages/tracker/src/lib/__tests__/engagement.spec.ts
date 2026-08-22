import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Client } from "../client";
import * as requestModule from "../request";
import {
    clearEngagement,
    computeScrollDepth,
    flushEngagement,
    onEngagementHidden,
    onEngagementPagehide,
    onEngagementPageshowPersisted,
    onEngagementVisible,
    startEngagement,
} from "../engagement";

describe("engagement lifecycle", () => {
    let client: Client;
    let makeRequestMock: ReturnType<typeof vi.fn>;
    let sendLifecycleRequestMock: ReturnType<typeof vi.fn>;
    let now: number;

    beforeEach(() => {
        now = 0;
        vi.spyOn(performance, "now").mockImplementation(() => now);

        makeRequestMock = vi.fn();
        sendLifecycleRequestMock = vi.fn();
        vi.spyOn(requestModule, "makeRequest").mockImplementation(
            makeRequestMock as typeof requestModule.makeRequest,
        );
        vi.spyOn(requestModule, "sendLifecycleRequest").mockImplementation(
            sendLifecycleRequestMock as typeof requestModule.sendLifecycleRequest,
        );

        client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
        });
    });

    afterEach(() => {
        client.cleanup();
        vi.restoreAllMocks();
    });

    function setVisibilityState(state: "visible" | "hidden") {
        Object.defineProperty(document, "visibilityState", {
            writable: true,
            configurable: true,
            value: state,
        });
    }

    test("starts an engagement context on first pageview", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        expect(client._engagement).toEqual(
            expect.objectContaining({
                hostname: "http://example.com",
                path: "/page",
                accumulatedMs: 0,
                sentMs: 0,
                visible: true,
                maxScrollDepth: 0,
                sentScrollDepth: 0,
                hasScrolled: false,
                pendingAnimationFrame: null,
            }),
        );
    });

    test("flushes the unsent delta on visibility hidden", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 5000;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                et: "engagement",
                e: "5000",
                p: "/page",
                h: "http://example.com",
                sid: "test-site",
            }),
        );
        expect(makeRequestMock).not.toHaveBeenCalled();
    });

    test("does not flush a sub-second delta", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 500;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        expect(sendLifecycleRequestMock).not.toHaveBeenCalled();
    });

    test("does not resend an already-flushed delta", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 5000;
        setVisibilityState("hidden");
        onEngagementHidden(client);
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);

        // Resume, then hide again with only a small additional amount.
        now = 5200;
        setVisibilityState("visible");
        onEngagementVisible(client);

        now = 5400;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        // Total new delta is only 400ms, so nothing is sent.
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
    });

    test("sends only the new delta after resuming visibility", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 5000;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        now = 6000;
        setVisibilityState("visible");
        onEngagementVisible(client);

        now = 8500;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(2);
        expect(sendLifecycleRequestMock).toHaveBeenLastCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ e: "2500" }),
        );
    });

    test("flushes the previous page delta before resetting on SPA navigation", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/first", "");

        now = 3000;
        startEngagement(client, "http://example.com", "/second", "");

        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        expect(makeRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                et: "engagement",
                e: "3000",
                p: "/first",
            }),
        );
        expect(client._engagement?.path).toBe("/second");
    });

    test("keeps previous path attribution when history has changed", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/original", "");

        now = 4000;
        startEngagement(client, "http://example.com", "/new", "");

        expect(makeRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ p: "/original" }),
        );
    });

    test("flushes the prior delta and resets the context when the same path is tracked again", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/same", "");

        now = 3000;
        startEngagement(client, "http://example.com", "/same", "");

        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        expect(makeRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                et: "engagement",
                e: "3000",
                p: "/same",
            }),
        );
        expect(client._engagement?.accumulatedMs).toBe(0);
        expect(client._engagement?.startTime).toBe(3000);
    });

    test("discards a sub-second prior context instead of carrying it into the next pageview", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/same", "");

        now = 500;
        startEngagement(client, "http://example.com", "/same", "");

        expect(makeRequestMock).not.toHaveBeenCalled();
        expect(client._engagement?.accumulatedMs).toBe(0);
        expect(client._engagement?.startTime).toBe(500);
    });

    test("resumes the same context after a bfcache restore", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 4000;
        onEngagementPagehide(client);
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);

        now = 5000;
        setVisibilityState("visible");
        onEngagementPageshowPersisted(client);

        now = 7000;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(2);
        expect(sendLifecycleRequestMock).toHaveBeenLastCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ e: "2000" }),
        );
    });

    test("pagehide flushes the final delta", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 7000;
        onEngagementPagehide(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ e: "7000" }),
        );
    });

    test("cleanup flushes the final engagement delta", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 9000;
        flushEngagement(client, true);
        clearEngagement(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({ e: "9000" }),
        );
        expect(client._engagement).toBeUndefined();
    });

    test("does not send a final flush for an already-sent delta", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 5000;
        setVisibilityState("hidden");
        onEngagementHidden(client);
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);

        now = 5500;
        onEngagementPagehide(client);

        // Only 500ms of new time; no additional event.
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
    });

    test("suppresses engagement while hidden", () => {
        setVisibilityState("visible");
        startEngagement(client, "http://example.com", "/page", "");

        now = 3000;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        now = 4000;
        // Hidden while already hidden should be a no-op.
        onEngagementHidden(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
    });
});

describe("scroll depth", () => {
    let client: Client;
    let makeRequestMock: ReturnType<typeof vi.fn>;
    let sendLifecycleRequestMock: ReturnType<typeof vi.fn>;
    let now: number;

    const originalDescriptors = new Map<
        object,
        Map<string, PropertyDescriptor | undefined>
    >();

    function captureDescriptor(obj: object, prop: string) {
        if (!originalDescriptors.has(obj)) {
            originalDescriptors.set(obj, new Map());
        }
        originalDescriptors
            .get(obj)!
            .set(prop, Object.getOwnPropertyDescriptor(obj, prop));
    }

    function restoreDescriptors() {
        for (const [obj, props] of originalDescriptors) {
            for (const [prop, desc] of props) {
                if (desc) {
                    Object.defineProperty(obj, prop, desc);
                } else {
                    // Property did not exist before the test; remove our mock.
                    delete (obj as Record<string, unknown>)[prop];
                }
            }
        }
        originalDescriptors.clear();
    }

    beforeEach(() => {
        // Capture the original descriptors for every dimension property this
        // suite may override, so tests do not leak mocked values to each other.
        captureDescriptor(document.documentElement, "scrollHeight");
        captureDescriptor(document.documentElement, "offsetHeight");
        captureDescriptor(document.documentElement, "clientHeight");
        captureDescriptor(document.body, "scrollHeight");
        captureDescriptor(document.body, "offsetHeight");
        captureDescriptor(document.body, "clientHeight");
        captureDescriptor(window, "scrollY");
        captureDescriptor(window, "innerHeight");

        now = 0;
        vi.spyOn(performance, "now").mockImplementation(() => now);

        makeRequestMock = vi.fn();
        sendLifecycleRequestMock = vi.fn();
        vi.spyOn(requestModule, "makeRequest").mockImplementation(
            makeRequestMock as typeof requestModule.makeRequest,
        );
        vi.spyOn(requestModule, "sendLifecycleRequest").mockImplementation(
            sendLifecycleRequestMock as typeof requestModule.sendLifecycleRequest,
        );

        client = new Client({
            siteId: "test-site",
            reporterUrl: "https://example.com/collect",
            autoTrackPageviews: false,
        });

        setVisibilityState("visible");
        setWindowInnerHeight(1000);
    });

    afterEach(() => {
        client.cleanup();
        vi.restoreAllMocks();
        restoreDescriptors();
    });

    function setVisibilityState(state: "visible" | "hidden") {
        Object.defineProperty(document, "visibilityState", {
            writable: true,
            configurable: true,
            value: state,
        });
    }

    function setWindowScroll(scrollY: number) {
        Object.defineProperty(window, "scrollY", {
            writable: true,
            configurable: true,
            value: scrollY,
        });
    }

    function setWindowInnerHeight(height: number) {
        Object.defineProperty(window, "innerHeight", {
            writable: true,
            configurable: true,
            value: height,
        });
    }

    function setDocumentDimensions(dimensions: {
        scrollHeight?: number;
        offsetHeight?: number;
        clientHeight?: number;
    }) {
        const html = document.documentElement;
        Object.defineProperty(html, "scrollHeight", {
            writable: true,
            configurable: true,
            value: dimensions.scrollHeight ?? html.scrollHeight,
        });
        Object.defineProperty(html, "offsetHeight", {
            writable: true,
            configurable: true,
            value: dimensions.offsetHeight ?? html.offsetHeight,
        });
        Object.defineProperty(html, "clientHeight", {
            writable: true,
            configurable: true,
            value: dimensions.clientHeight ?? html.clientHeight,
        });
    }

    function setBodyDimensions(dimensions: {
        scrollHeight?: number;
        offsetHeight?: number;
        clientHeight?: number;
    }) {
        const body = document.body;
        Object.defineProperty(body, "scrollHeight", {
            writable: true,
            configurable: true,
            value: dimensions.scrollHeight ?? body.scrollHeight,
        });
        Object.defineProperty(body, "offsetHeight", {
            writable: true,
            configurable: true,
            value: dimensions.offsetHeight ?? body.offsetHeight,
        });
        Object.defineProperty(body, "clientHeight", {
            writable: true,
            configurable: true,
            value: dimensions.clientHeight ?? body.clientHeight,
        });
    }

    test("short page reports 100 on initial load", () => {
        setDocumentDimensions({ scrollHeight: 500, clientHeight: 500 });
        setWindowScroll(0);

        startEngagement(client, "http://example.com", "/short", "");

        expect(client._engagement?.maxScrollDepth).toBe(100);
    });

    test("initial viewport depth is bounded 0..100", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);

        startEngagement(client, "http://example.com", "/page", "");

        expect(client._engagement?.maxScrollDepth).toBe(50);
    });

    test("max scroll depth is monotonic", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");
        expect(client._engagement?.maxScrollDepth).toBe(50);

        // Directly update depth as if a scroll handler fired.
        setWindowScroll(500);
        const state = client._engagement!;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }
        expect(state.maxScrollDepth).toBe(75);

        // Scrolling back up must not reduce the recorded maximum.
        setWindowScroll(100);
        const lowerDepth = computeScrollDepth();
        if (lowerDepth > state.maxScrollDepth) {
            state.maxScrollDepth = lowerDepth;
        }
        expect(state.maxScrollDepth).toBe(75);
    });

    test("dynamic height changes are handled", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setDocumentDimensions({ scrollHeight: 4000, clientHeight: 4000 });
        setWindowScroll(1000);
        const state = client._engagement!;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }
        // viewportBottom = 1000 + 1000 = 2000; 2000/4000 = 50%
        expect(state.maxScrollDepth).toBe(50);
    });

    test("uses body dimensions when documentElement is short", () => {
        setDocumentDimensions({ scrollHeight: 100, clientHeight: 100 });
        setBodyDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);

        startEngagement(client, "http://example.com", "/page", "");

        // Uses max of html/body = 2000.
        expect(client._engagement?.maxScrollDepth).toBe(50);
    });

    test("zero document height returns 0 safely", () => {
        setDocumentDimensions({ scrollHeight: 0, clientHeight: 0 });
        setBodyDimensions({ scrollHeight: 0, clientHeight: 0 });
        setWindowScroll(0);

        startEngagement(client, "http://example.com", "/empty", "");

        expect(client._engagement?.maxScrollDepth).toBe(0);
    });

    test("scroll listener updates max depth using requestAnimationFrame throttling", () => {
        const frames: Array<() => void> = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            frames.push(cb as () => void);
            return frames.length;
        });

        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(500);
        window.dispatchEvent(new Event("scroll"));
        setWindowScroll(700);
        window.dispatchEvent(new Event("scroll"));
        setWindowScroll(900);
        window.dispatchEvent(new Event("scroll"));

        // Only one animation frame should be scheduled despite three scrolls.
        expect(frames.length).toBe(1);

        // Flush the pending frame: it should record the last scroll position.
        frames[0]();
        expect(client._engagement?.maxScrollDepth).toBe(95);
    });

    test("cleanup cancels pending scroll work and removes listener", () => {
        const frames: Array<() => void> = [];
        let nextId = 1;
        const ids = new Set<number>();
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            frames.push(cb as () => void);
            const id = nextId++;
            ids.add(id);
            return id;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            ids.delete(id as number);
        });

        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(500);
        window.dispatchEvent(new Event("scroll"));

        expect(frames.length).toBe(1);
        client.cleanup();
        expect(ids.size).toBe(0);
    });

    test("SPA reset does not let a stale animation frame mutate the new context", () => {
        const frames: Array<() => void> = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            frames.push(cb as () => void);
            return frames.length;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            frames[(id as number) - 1] = () => {};
        });

        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/first", "");

        setWindowScroll(500);
        window.dispatchEvent(new Event("scroll"));
        expect(frames.length).toBe(1);

        // Reset to a new page before the queued frame fires.
        setDocumentDimensions({ scrollHeight: 500, clientHeight: 500 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/second", "");

        // The stale frame, if it fires, must not change the new context.
        frames.forEach((frame) => frame());
        expect(client._engagement?.path).toBe("/second");
        expect(client._engagement?.maxScrollDepth).toBe(100);
    });

    test("visibility changes recompute depth for the restored page", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setVisibilityState("hidden");
        onEngagementHidden(client);

        // Simulate content expanding while hidden.
        setDocumentDimensions({ scrollHeight: 4000, clientHeight: 4000 });
        setWindowScroll(1000);

        setVisibilityState("visible");
        onEngagementVisible(client);

        expect(client._engagement?.maxScrollDepth).toBe(50);
    });

    test("bfcache restore recomputes depth", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        onEngagementPagehide(client);

        // Simulate the user scrolling the restored page before pageshow.
        setDocumentDimensions({ scrollHeight: 4000, clientHeight: 4000 });
        setWindowScroll(1500);

        setVisibilityState("visible");
        onEngagementPageshowPersisted(client);

        // viewportBottom = 1500 + 1000 = 2500; 2500/4000 = 62.5 -> 63
        expect(client._engagement?.maxScrollDepth).toBe(63);
    });

    test("hidden flush captures the newest scroll sample before cancelling pending work", () => {
        const frames: Array<() => void> = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            frames.push(cb as () => void);
            return frames.length;
        });

        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        // Scroll, scheduling a pending rAF that has not fired yet.
        setWindowScroll(500);
        window.dispatchEvent(new Event("scroll"));
        expect(frames.length).toBe(1);

        now = 5000;
        setVisibilityState("hidden");
        onEngagementHidden(client);

        // The lifecycle flush must include the latest scroll position (75%)
        // even though the rAF callback never ran.
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                e: "5000",
                sd: "75",
            }),
        );
    });

    test("pagehide flush captures the newest scroll sample before cancelling pending work", () => {
        const frames: Array<() => void> = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            frames.push(cb as () => void);
            return frames.length;
        });

        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(500);
        window.dispatchEvent(new Event("scroll"));
        expect(frames.length).toBe(1);

        now = 7000;
        onEngagementPagehide(client);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                e: "7000",
                sd: "75",
            }),
        );
    });

    test("SPA reset does not resample the previous page DOM before flushing", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/first", "");

        // Simulate a scroll on /first that has been recorded.
        setWindowScroll(500);
        const state = client._engagement!;
        state.hasScrolled = true;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }

        // Before flushing, mutate the DOM as if the SPA framework has already
        // rendered the next page. startEngagement must not resample this new
        // DOM and attribute it to /first.
        setDocumentDimensions({ scrollHeight: 500, clientHeight: 500 });
        setWindowScroll(0);

        now = 3000;
        startEngagement(client, "http://example.com", "/second", "");

        expect(makeRequestMock).toHaveBeenCalledTimes(1);
        expect(makeRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                p: "/first",
                sd: "75",
            }),
        );
    });

    test("flush sends both duration and scroll depth", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(1000);
        const state = client._engagement!;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }

        now = 5000;
        flushEngagement(client, true);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                et: "engagement",
                e: "5000",
                sd: "100",
                p: "/page",
            }),
        );
    });

    test("scroll-only flush sends e=0 and does not add duration", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(500);
        const state = client._engagement!;
        state.hasScrolled = true;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }

        // Only 500ms of active time, but depth increased.
        now = 500;
        flushEngagement(client, true);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        expect(sendLifecycleRequestMock).toHaveBeenCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                et: "engagement",
                e: "0",
                sd: "75",
            }),
        );
        expect(client._engagement?.sentMs).toBe(0);
        expect(client._engagement?.sentScrollDepth).toBe(75);
    });

    test("duplicate scroll depth is suppressed", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(500);
        const state = client._engagement!;
        state.hasScrolled = true;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }

        now = 500;
        flushEngagement(client, true);
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);

        // Flush again with no further depth increase.
        flushEngagement(client, true);
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
    });

    test("a later duration flush sends previously unsent subsecond time once it reaches 1s", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");

        setWindowScroll(500);
        const state = client._engagement!;
        state.hasScrolled = true;
        const depth = computeScrollDepth();
        if (depth > state.maxScrollDepth) {
            state.maxScrollDepth = depth;
        }

        now = 500;
        flushEngagement(client, true);
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);

        now = 1500;
        flushEngagement(client, true);

        // Total unsent time is now 1500ms; the first 500ms was sent as part of
        // the scroll-only event (e=0) without advancing sentMs, so the full
        // 1500ms is now flushed.
        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(2);
        expect(sendLifecycleRequestMock).toHaveBeenLastCalledWith(
            "https://example.com/collect",
            expect.objectContaining({
                e: "1500",
                sd: "75",
            }),
        );
    });

    test("engagement delta is capped at 30 days", () => {
        setDocumentDimensions({ scrollHeight: 2000, clientHeight: 2000 });
        startEngagement(client, "http://example.com", "/page", "");

        now = 31 * 24 * 60 * 60 * 1000;
        flushEngagement(client, true);

        expect(sendLifecycleRequestMock).toHaveBeenCalledTimes(1);
        const params = sendLifecycleRequestMock.mock.calls[0][1];
        expect(Number(params.e)).toBe(30 * 24 * 60 * 60 * 1000);
    });

    test("initial viewport depth is not sent as a standalone scroll-only event", () => {
        setDocumentDimensions({ scrollHeight: 500, clientHeight: 500 });
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/short", "");
        expect(client._engagement?.maxScrollDepth).toBe(100);

        now = 500;
        flushEngagement(client, true);

        // No real scroll occurred; do not emit a scroll-only heartbeat.
        expect(sendLifecycleRequestMock).not.toHaveBeenCalled();
    });

    test("resets scroll depth on every tracked pageview, including same-path boundaries", () => {
        setDocumentDimensions({ scrollHeight: 4000, clientHeight: 4000 });
        setWindowScroll(1500);
        startEngagement(client, "http://example.com", "/page", "");
        expect(client._engagement?.maxScrollDepth).toBe(63);

        // Track the same path again; depth should reset to the current initial
        // depth, not carry over the previous maximum.
        setWindowScroll(0);
        startEngagement(client, "http://example.com", "/page", "");
        expect(client._engagement?.maxScrollDepth).toBe(25);
    });
});
