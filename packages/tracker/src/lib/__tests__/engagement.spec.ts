import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Client } from "../client";
import * as requestModule from "../request";
import {
    clearEngagement,
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
