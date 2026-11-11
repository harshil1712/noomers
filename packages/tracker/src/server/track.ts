import type { ServerClient } from "./client";
import { makeRequest } from "./request";
import type { ServerTrackEventOpts, ServerTrackPageviewOpts } from "./types";
import {
    getHostnameAndPath,
    getReferrer,
    getUtmParamsFromUrl,
    isLocalhostAddress,
    mergeUtmParams,
} from "../shared/utils";
import { buildCollectRequestParams } from "../shared/request";
import type { UtmParams } from "../shared/types";

function getUtmParamsFromOpts(opts: ServerTrackPageviewOpts): UtmParams {
    const utmParams: UtmParams = {};

    if (opts.utmSource) utmParams.us = opts.utmSource;
    if (opts.utmMedium) utmParams.um = opts.utmMedium;
    if (opts.utmCampaign) utmParams.uc = opts.utmCampaign;
    if (opts.utmTerm) utmParams.ut = opts.utmTerm;
    if (opts.utmContent) utmParams.uco = opts.utmContent;

    return utmParams;
}

export async function trackPageview(
    client: ServerClient,
    opts: ServerTrackPageviewOpts,
) {
    // Validate required parameters
    if (!opts.url) {
        throw new Error("url is required for server-side tracking");
    }

    let fullUrl: string;
    try {
        // If URL is relative, we need a hostname to make it absolute
        if (opts.url.startsWith("/")) {
            if (!opts.hostname) {
                throw new Error(
                    "hostname is required when tracking relative URLs",
                );
            }
            const protocol =
                opts.hostname.startsWith("localhost") ||
                opts.hostname.includes("127.0.0.1")
                    ? "http://"
                    : "https://";
            fullUrl = `${protocol}${opts.hostname}${opts.url}`;
        } else {
            fullUrl = opts.url;
        }

        // Validate URL format
        new URL(fullUrl);
    } catch (error) {
        // Re-throw hostname-specific errors
        if (
            error instanceof Error &&
            error.message.includes("hostname is required")
        ) {
            throw error;
        }
        throw new Error(`Invalid URL: ${opts.url}`);
    }

    const { hostname, path } = getHostnameAndPath(fullUrl);

    // Check localhost reporting setting
    if (
        !client.reportOnLocalhost &&
        isLocalhostAddress(new URL(fullUrl).hostname)
    ) {
        return;
    }

    const referrer = getReferrer(hostname, opts.referrer || "");

    // Get UTM params from URL first, then override with explicit opts
    const urlUtmParams = getUtmParamsFromUrl(fullUrl);
    const optsUtmParams = getUtmParamsFromOpts(opts);
    const utmParams = mergeUtmParams(urlUtmParams, optsUtmParams);

    // Server-side tracking defaults to hit type 1 (new visit)
    // since we don't have browser session tracking
    const requestParams = buildCollectRequestParams(
        client.siteId,
        hostname,
        path,
        referrer,
        utmParams,
        "1",
    );

    await makeRequest(
        client.reporterUrl,
        requestParams,
        client.timeout,
        opts.userAgent || client.userAgent,
    );
}

export async function trackEvent(
    client: ServerClient,
    name: string,
    opts: ServerTrackEventOpts,
) {
    const eventName = name.trim();
    if (!eventName || eventName.length > 64) {
        throw new Error("Event name must be between 1 and 64 characters.");
    }

    if (!opts.url) {
        throw new Error("url is required for server-side tracking");
    }

    let fullUrl = opts.url;
    if (opts.url.startsWith("/")) {
        if (!opts.hostname) {
            throw new Error("hostname is required when tracking relative URLs");
        }
        fullUrl = `https://${opts.hostname}${opts.url}`;
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(fullUrl);
    } catch {
        throw new Error(`Invalid URL: ${opts.url}`);
    }

    if (!client.reportOnLocalhost && isLocalhostAddress(parsedUrl.hostname)) {
        return;
    }

    const { hostname, path } = getHostnameAndPath(fullUrl);
    const referrer = getReferrer(hostname, opts.referrer || "");
    const urlUtmParams = getUtmParamsFromUrl(fullUrl);
    const optsUtmParams = getUtmParamsFromOpts(opts);
    const requestParams = buildCollectRequestParams(
        client.siteId,
        hostname,
        path,
        referrer,
        mergeUtmParams(urlUtmParams, optsUtmParams),
        undefined,
        {
            name: eventName,
            props: opts.props,
            revenue: opts.revenue,
        },
        opts.ip,
    );

    await makeRequest(
        client.reporterUrl,
        requestParams,
        client.timeout,
        opts.userAgent || client.userAgent,
    );
}
