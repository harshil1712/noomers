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
};

declare module "./client" {
    interface Client {
        _engagement?: EngagementContext;
    }
}

function currentTime(): number {
    return performance.now();
}

export function startEngagement(
    client: Client,
    hostname: string,
    path: string,
    referrer: string,
) {
    // Every tracked pageview is a new boundary. Flush any previous context
    // (sub-second deltas are discarded automatically) and start fresh.
    if (client._engagement) {
        flushEngagement(client, false);
    }

    client._engagement = {
        hostname,
        path,
        referrer,
        startTime: currentTime(),
        accumulatedMs: 0,
        sentMs: 0,
        visible: document.visibilityState === "visible",
    };
}

export function onEngagementVisible(client: Client) {
    const state = client._engagement;
    if (!state || state.visible) return;

    state.visible = true;
    state.startTime = currentTime();
}

export function onEngagementHidden(client: Client) {
    const state = client._engagement;
    if (!state || !state.visible) return;

    state.accumulatedMs += Math.max(0, currentTime() - state.startTime);
    state.visible = false;
    flushEngagement(client, true);
}

export function onEngagementPagehide(client: Client) {
    const state = client._engagement;
    if (!state) return;

    if (state.visible) {
        state.accumulatedMs += Math.max(0, currentTime() - state.startTime);
        state.visible = false;
    }
    flushEngagement(client, true);
}

export function onEngagementPageshowPersisted(client: Client) {
    const state = client._engagement;
    if (!state) return;

    state.visible = document.visibilityState === "visible";
    state.startTime = currentTime();
}

export function flushEngagement(client: Client, lifecycle: boolean) {
    const state = client._engagement;
    if (!state) return;

    if (state.visible) {
        state.accumulatedMs += Math.max(0, currentTime() - state.startTime);
        state.startTime = currentTime();
    }

    const rawDelta = Math.floor(state.accumulatedMs - state.sentMs);
    if (rawDelta < MIN_ENGAGEMENT_DELTA_MS) return;

    const delta = Math.min(rawDelta, MAX_ENGAGEMENT_DELTA_MS);
    const params = buildEngagementRequestParams(
        client.siteId,
        state.hostname,
        state.path,
        state.referrer,
        delta,
        0,
    );

    if (lifecycle) {
        sendLifecycleRequest(client.reporterUrl, params);
    } else {
        makeRequest(client.reporterUrl, params);
    }

    state.sentMs += delta;
}

export function clearEngagement(client: Client) {
    client._engagement = undefined;
}
