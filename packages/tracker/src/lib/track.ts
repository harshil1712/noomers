import type { Client } from "./client";
import { instrumentHistoryBuiltIns } from "./instrument";
import { makeRequest, checkCacheStatus } from "./request";
import { startEngagement } from "./engagement";
import {
    getHostnameAndPath,
    getReferrer,
    getUtmParamsFromBrowserUrl,
    isLocalhostAddress,
} from "../shared/utils";
import { buildCollectRequestParams } from "../shared/request";
import type { EventProperties } from "../shared/types";

export type TrackPageviewOpts = {
    url?: string;
    referrer?: string;
};

export type TrackEventOpts = TrackPageviewOpts & {
    props?: EventProperties;
};

export function autoTrackPageviews(client: Client) {
    const cleanupFn = instrumentHistoryBuiltIns(() => {
        void trackPageview(client);
    });

    void trackPageview(client);

    return cleanupFn;
}

function isIgnoredByStorage(): boolean {
    try {
        return localStorage.getItem("noomers_ignore") === "true";
    } catch {
        return false;
    }
}

function shouldSkip(client: Client): boolean {
    if (
        !client.reportOnLocalhost &&
        (isLocalhostAddress(window.location.hostname) ||
            navigator.webdriver === true)
    ) {
        return true;
    }
    return isIgnoredByStorage();
}

function getCanonicalUrl() {
    const canonical = document.querySelector(
        'link[rel="canonical"][href]',
    ) as HTMLLinkElement;
    if (!canonical) {
        return null;
    }

    const a = document.createElement("a");
    a.href = canonical.href;
    return a;
}

function getBrowserReferrer(hostname: string, referrer: string): string {
    // First, check if we have an explicit referrer parameter
    if (referrer) {
        return getReferrer(hostname, referrer);
    }

    // If no explicit referrer, check document.referrer
    if (document.referrer && document.referrer.indexOf(hostname) < 0) {
        return getReferrer(hostname, document.referrer);
    }

    // If still no referrer, check query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const referrerParams = [
        "ref",
        "referer",
        "referrer",
        "source",
        "utm_source",
    ];

    for (const param of referrerParams) {
        const value = urlParams.get(param);
        if (value) {
            return getReferrer(hostname, value);
        }
    }

    return getReferrer(hostname, "");
}

export async function trackPageview(
    client: Client,
    opts: TrackPageviewOpts = {},
) {
    const canonical = getCanonicalUrl();
    const location = canonical ?? window.location;

    if (shouldSkip(client)) {
        return;
    }

    // if host is empty, we're probably loading a file:/// URI
    // -- exit early if this is not an Electron app
    if (location.host === "" && navigator.userAgent.indexOf("Electron") < 0) {
        return;
    }

    const url = opts.url || location.pathname + location.search || "/";

    const { hostname, path } = getHostnameAndPath(url, true);
    const referrer = getBrowserReferrer(hostname, opts.referrer || "");
    const utmParams = getUtmParamsFromBrowserUrl(url);

    // Start (or reset) the engagement context for this pageview. If the path
    // changed from a previous context, the previous page's delta is flushed
    // first so attribution stays with the page where the time was spent.
    startEngagement(client, hostname, path, referrer);

    let hitType: string | undefined;

    const send = (ht: string | undefined) => {
        const requestParams = buildCollectRequestParams(
            client.siteId,
            hostname,
            path,
            referrer,
            utmParams,
            ht,
        );
        makeRequest(client.reporterUrl, requestParams);
    };

    // If the page unloads while /cache is pending, flushPendingPageview sends
    // with the "1" fallback; otherwise the resolved ht is used. Either way the
    // pageview is sent exactly once.
    flushPendingPageview();
    pendingPageview = send;
    try {
        const cacheStatus = await checkCacheStatus(
            client.reporterUrl,
            client.siteId,
        );
        hitType = cacheStatus.ht.toString();
    } catch {
        // If cache check fails, we proceed without hit count data
        // The collect endpoint will handle the missing parameters
    }

    if (pendingPageview === send) {
        pendingPageview = undefined;
        send(hitType);
    }
}

let pendingPageview: ((ht?: string) => void) | undefined;

export function flushPendingPageview() {
    const send = pendingPageview;
    pendingPageview = undefined;
    send?.("1");
}

export async function trackEvent(
    client: Client,
    name: string,
    opts: TrackEventOpts = {},
) {
    const eventName = name.trim();
    if (!eventName || eventName.length > 64) {
        throw new Error("Event name must be between 1 and 64 characters.");
    }

    if (shouldSkip(client)) {
        return;
    }

    const canonical = getCanonicalUrl();
    const location = canonical ?? window.location;
    const url = opts.url || location.pathname + location.search || "/";
    const { hostname, path } = getHostnameAndPath(url, true);
    const referrer = getBrowserReferrer(hostname, opts.referrer || "");
    const utmParams = getUtmParamsFromBrowserUrl(url);
    const requestParams = buildCollectRequestParams(
        client.siteId,
        hostname,
        path,
        referrer,
        utmParams,
        undefined,
        { name: eventName, props: opts.props },
    );

    makeRequest(client.reporterUrl, requestParams);
}
