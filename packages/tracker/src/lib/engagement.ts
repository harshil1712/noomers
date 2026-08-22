import type { Client } from "./client";
import { makeRequest, sendLifecycleRequest } from "./request";
import { buildEngagementRequestParams } from "../shared/request";

const MIN_ENGAGEMENT_DELTA_MS = 1000;
const MAX_ENGAGEMENT_DELTA_MS = 30 * 24 * 60 * 60 * 1000;

export type EngagementContext = {
    path: string;
    hostname: string;
    referrer: string;
    startTime: number;
    accumulatedMs: number;
    sentMs: number;
    visible: boolean;
    maxScrollDepth: number;
    sentScrollDepth: number;
    hasScrolled: boolean;
    pendingAnimationFrame: number | null;
    cleanupScrollListener?: () => void;
};

declare module "./client" {
    interface Client {
        _engagement?: EngagementContext;
    }
}

function currentTime(): number {
    return performance.now();
}

function getDocumentHeight(): number {
    const body = document.body;
    const html = document.documentElement;
    return Math.max(
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        body?.clientHeight || 0,
        html?.scrollHeight || 0,
        html?.offsetHeight || 0,
        html?.clientHeight || 0,
    );
}

export function computeScrollDepth(): number {
    const documentHeight = getDocumentHeight();
    if (documentHeight <= 0) {
        return 0;
    }

    const viewportBottom = window.scrollY + window.innerHeight;
    const depth = Math.round((viewportBottom / documentHeight) * 100);
    return Math.min(100, Math.max(0, depth));
}

function updateMaxScrollDepth(state: EngagementContext): void {
    const depth = computeScrollDepth();
    if (depth > state.maxScrollDepth) {
        state.maxScrollDepth = depth;
    }
}

function scheduleScrollDepthUpdate(state: EngagementContext): void {
    state.hasScrolled = true;
    if (state.pendingAnimationFrame !== null) return;

    state.pendingAnimationFrame = requestAnimationFrame(() => {
        state.pendingAnimationFrame = null;
        updateMaxScrollDepth(state);
    });
}

function cancelPendingScrollWork(state: EngagementContext): void {
    if (state.pendingAnimationFrame !== null) {
        cancelAnimationFrame(state.pendingAnimationFrame);
        state.pendingAnimationFrame = null;
    }
}

export function startEngagement(
    client: Client,
    hostname: string,
    path: string,
    referrer: string,
) {
    // Every tracked pageview is a new boundary. Flush any previous context
    // (sub-second deltas are discarded automatically), clean up its scroll
    // listener and pending animation frame, and start fresh.
    if (client._engagement) {
        flushEngagement(client, false);
        clearEngagement(client);
    }

    const state: EngagementContext = {
        hostname,
        path,
        referrer,
        startTime: currentTime(),
        accumulatedMs: 0,
        sentMs: 0,
        visible: document.visibilityState === "visible",
        maxScrollDepth: 0,
        sentScrollDepth: 0,
        hasScrolled: false,
        pendingAnimationFrame: null,
    };

    // Capture the initial depth. Short pages may report 100 immediately.
    updateMaxScrollDepth(state);

    const onScroll = () => scheduleScrollDepthUpdate(state);
    window.addEventListener("scroll", onScroll, { passive: true });
    state.cleanupScrollListener = () => {
        window.removeEventListener("scroll", onScroll);
    };

    client._engagement = state;
}

export function onEngagementVisible(client: Client) {
    const state = client._engagement;
    if (!state || state.visible) return;

    state.visible = true;
    state.startTime = currentTime();
    // The DOM may have changed while hidden; recompute depth safely for the
    // same page context.
    updateMaxScrollDepth(state);
}

export function onEngagementHidden(client: Client) {
    const state = client._engagement;
    if (!state || !state.visible) return;

    state.accumulatedMs += Math.max(0, currentTime() - state.startTime);
    state.visible = false;
    // The DOM still belongs to this page, so capture any pending scroll sample
    // before the flush cancels outstanding animation-frame work.
    cancelPendingScrollWork(state);
    updateMaxScrollDepth(state);
    flushEngagement(client, true);
}

export function onEngagementPagehide(client: Client) {
    const state = client._engagement;
    if (!state) return;

    if (state.visible) {
        state.accumulatedMs += Math.max(0, currentTime() - state.startTime);
        state.visible = false;
    }
    cancelPendingScrollWork(state);
    updateMaxScrollDepth(state);
    flushEngagement(client, true);
}

export function onEngagementPageshowPersisted(client: Client) {
    const state = client._engagement;
    if (!state) return;

    state.visible = document.visibilityState === "visible";
    state.startTime = currentTime();
    // The restored page may have a different effective depth; recompute it
    // for the existing context without inspecting the new page DOM.
    updateMaxScrollDepth(state);
}

export function flushEngagement(client: Client, lifecycle: boolean) {
    const state = client._engagement;
    if (!state) return;

    if (state.visible) {
        state.accumulatedMs += Math.max(0, currentTime() - state.startTime);
        state.startTime = currentTime();
    }

    const rawDelta = Math.floor(state.accumulatedMs - state.sentMs);
    const rawDepthDelta = state.maxScrollDepth - state.sentScrollDepth;

    // Require either a full second of unsent active time or a real scroll
    // increase beyond the initial viewport. Scroll-only flushes use e=0 and
    // do not add duration.
    if (
        rawDelta < MIN_ENGAGEMENT_DELTA_MS &&
        (!state.hasScrolled || rawDepthDelta <= 0)
    )
        return;

    const delta =
        rawDelta < MIN_ENGAGEMENT_DELTA_MS
            ? 0
            : Math.min(rawDelta, MAX_ENGAGEMENT_DELTA_MS);
    const depth = state.maxScrollDepth > 0 ? state.maxScrollDepth : 0;

    const params = buildEngagementRequestParams(
        client.siteId,
        state.hostname,
        state.path,
        state.referrer,
        delta,
        depth,
    );

    if (lifecycle) {
        sendLifecycleRequest(client.reporterUrl, params);
    } else {
        makeRequest(client.reporterUrl, params);
    }

    state.sentMs += delta;
    state.sentScrollDepth = state.maxScrollDepth;
}

export function clearEngagement(client: Client) {
    const state = client._engagement;
    if (state) {
        state.cleanupScrollListener?.();
        cancelPendingScrollWork(state);
    }
    client._engagement = undefined;
}
