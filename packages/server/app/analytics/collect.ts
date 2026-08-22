import type { AnalyticsEngineDataset } from "@cloudflare/workers-types";
import { IDevice, UAParser } from "ua-parser-js";
import { shouldDropBot } from "./bot";
import { maskBrowserVersion } from "~/lib/utils";
import { SitesRepository, type SiteCollectionStatus } from "~/sites/repository";

export type CollectEnv = Pick<Env, "WEB_COUNTER_AE"> &
    Partial<Pick<Env, "VISITOR_SALT" | "GOALS_DB">> & {
        EVENT_STREAM?: {
            send(records: DurableEvent[]): Promise<void>;
        };
    };

export async function getSiteCollectionStatus(
    env: CollectEnv,
    siteId: string,
): Promise<SiteCollectionStatus | "error"> {
    if (!env.GOALS_DB) return "error";
    try {
        return await new SitesRepository(env.GOALS_DB).collectionStatus(siteId);
    } catch (error) {
        console.error(
            JSON.stringify({
                message: "site collection status lookup failed",
                siteId,
                error: error instanceof Error ? error.message : String(error),
            }),
        );
        return "error";
    }
}

export function collectionStatusResponse(
    status: SiteCollectionStatus | "error",
    headers?: HeadersInit,
): Response | null {
    if (status === "active") return null;
    if (status === "deleted") {
        return new Response("Site deleted", { status: 410, headers });
    }
    if (status === "unknown") {
        return new Response("Site not found", { status: 404, headers });
    }
    return new Response("Site registry unavailable", { status: 503, headers });
}

// Cookieless visitor/session tracking
// Uses the approach described here: https://notes.normally.com/cookieless-unique-visitor-counts/

function getMidnightDate(): Date {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return midnight;
}

function getNextLastModifiedDate(current: Date | null): Date {
    // in case date is an 'Invalid Date'
    if (current && isNaN(current.getTime())) {
        current = null;
    }

    const midnight = getMidnightDate();

    // check if new day, if it is then set to midnight
    let next = current ? current : midnight;
    next = midnight.getTime() - next.getTime() > 0 ? midnight : next;

    // Next seconds value is the current seconds value + 1, capped at 3
    const currentSeconds = next.getSeconds();
    next.setSeconds(Math.min(3, currentSeconds + 1));

    return next;
}

/**
 * Calculate bounce value based on hit count
 * @param hits The number of hits (1-3)
 * @returns Bounce value: 1 (bounce), -1 (anti-bounce), or 0 (normal)
 */
function getBounceValue(hits: number): number {
    if (hits === 1) {
        return 1; // First hit = bounce
    } else if (hits === 2) {
        return -1; // Second hit = anti-bounce
    } else {
        return 0; // Third+ hit = normal
    }
}

/**
 * Checks if the request indicates a new visitor based on the If-Modified-Since header.
 * Mimics browser caching behavior for cookieless tracking.
 * @param ifModifiedSince The value of the If-Modified-Since header.
 * @returns Object containing `newVisitor` boolean.
 */
function checkVisitorSession(ifModifiedSince: string | null): {
    newVisitor: boolean;
} {
    let newVisitor = true;

    if (ifModifiedSince) {
        // check today is a new day vs ifModifiedSince
        const today = new Date();
        const ifModifiedSinceDate = new Date(ifModifiedSince);
        if (
            today.getFullYear() === ifModifiedSinceDate.getFullYear() &&
            today.getMonth() === ifModifiedSinceDate.getMonth() &&
            today.getDate() === ifModifiedSinceDate.getDate()
        ) {
            // if ifModifiedSince is today, this is not a new visitor
            newVisitor = false;
        }
    }

    return { newVisitor };
}

/**
 * Handles cache-related headers (If-Modified-Since, Last-Modified) to determine
 * visitor status based on hit count for cookieless tracking.
 *
 * @param ifModifiedSince The value of the If-Modified-Since header from the request.
 * @returns An object containing:
 *  - `hits`: Number indicating the count of hits within the current session.
 *  - `nextLastModifiedDate`: The Date object to be set in the Last-Modified response header.
 */
export function handleCacheHeaders(ifModifiedSince: string | null): {
    hits: number;
    nextLastModifiedDate: Date;
} {
    const { newVisitor } = checkVisitorSession(ifModifiedSince);
    const nextLastModifiedDate = getNextLastModifiedDate(
        ifModifiedSince ? new Date(ifModifiedSince) : null,
    );

    // Calculate hits from the seconds component of the date
    // If it's a new day or first visit, hits will be 1
    // Otherwise, it's based on the seconds value, but capped at 3
    // 1 - first visit
    // 2 - anti bounce
    // 3 - regular page view (3+ hits)
    let hits = newVisitor ? 1 : nextLastModifiedDate.getSeconds();

    // Cap the hit count at 3 to avoid exposing exact hit counts publicly
    if (hits > 3) {
        hits = 3;
    }

    return {
        hits,
        nextLastModifiedDate,
    };
}

function extractParamsFromQueryString(requestUrl: string): {
    [key: string]: string;
} {
    const url = new URL(requestUrl);
    const queryString = url.search.slice(1).split("&");

    const params: { [key: string]: string } = {};

    queryString.forEach((item) => {
        const kv = item.split("=");
        if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1]);
    });
    return params;
}

function extractParams(value: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(value));
}

function getDeviceTypeFromDevice(device: IDevice): string {
    // see: https://github.com/faisalman/ua-parser-js/issues/182
    return device.type === undefined ? "desktop" : device.type;
}

const MAX_EVENT_NAME_LENGTH = 64;
const MAX_EVENT_PROPERTIES_LENGTH = 2048;
const MAX_COLLECT_BODY_BYTES = 32 * 1024;
const MIN_ENGAGEMENT_TIME_MS = 1000;
const MAX_ENGAGEMENT_TIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface DurableEvent {
    schema_version: 2;
    event_id: string;
    received_at: string;
    site_id: string;
    event_type: "pageview" | "custom" | "engagement";
    event_name: string;
    event_properties: string;
    url: string;
    hostname: string;
    pathname: string;
    referrer: string;
    interactive: boolean;
    revenue_amount: string;
    revenue_currency: string;
    engagement_time: number;
    scroll_depth: number;
    country: string;
    region: string;
    city: string;
    browser: string;
    browser_version: string;
    operating_system: string;
    operating_system_version: string;
    device_type: string;
    device_model: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_term: string;
    utm_content: string;
    visitor_id: string;
}

export interface NormalizedEvent {
    eventId: string;
    receivedAt: string;
    siteId: string;
    analyticsIndex: string;
    eventType: "pageview" | "custom" | "engagement";
    eventName: string;
    eventProperties: string;
    url: string;
    host: string;
    path: string;
    referrer: string;
    interactive: boolean;
    revenueAmount: string;
    revenueCurrency: string;
    engagementTime: number;
    scrollDepth: number;
    country: string;
    region: string;
    city: string;
    userAgent: string;
    browserName: string;
    browserVersion: string;
    operatingSystem: string;
    operatingSystemVersion: string;
    deviceModel: string;
    deviceType: string;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    utmTerm: string;
    utmContent: string;
    visitorId: string;
    newVisitor: number;
    newSession: number;
    bounce: number;
}

async function getAnalyticsIndex(siteId: string): Promise<string> {
    if (new TextEncoder().encode(siteId).byteLength <= 96) return siteId;

    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(siteId),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

export interface EventInput {
    siteId: string;
    eventType: NormalizedEvent["eventType"];
    eventName: string;
    eventProperties?: string;
    url?: string;
    host?: string;
    path?: string;
    referrer?: string;
    interactive?: boolean;
    revenueAmount?: string;
    revenueCurrency?: string;
    engagementTime?: number;
    scrollDepth?: number;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
    suppliedIp?: string;
    newVisitor?: number;
    bounce?: number;
}

export async function readCollectBody(
    request: Request,
    maxBytes = MAX_COLLECT_BODY_BYTES,
): Promise<string | null> {
    const contentLength = Number(request.headers.get("content-length"));
    if (contentLength > maxBytes) return null;
    if (!request.body) return "";

    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let body = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            return null;
        }
        body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
}

async function getDailyVisitorId(
    request: Request,
    env: CollectEnv,
    siteId: string,
    hostname: string,
    userAgent: string,
    suppliedIp?: string,
): Promise<string> {
    const ip = suppliedIp || request.headers.get("cf-connecting-ip");
    const salt = env.VISITOR_SALT || "";
    if (!ip || !salt) return "";

    const date = new Date().toISOString().slice(0, 10);
    const input = new TextEncoder().encode(
        `${salt}:${date}:${siteId}:${hostname}:${ip}:${userAgent}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

export async function normalizeEvent(
    request: Request,
    env: CollectEnv,
    input: EventInput,
    extra: Record<string, string> = {},
): Promise<NormalizedEvent> {
    const userAgent = request.headers.get("user-agent") || "";
    const parsedUserAgent = new UAParser(userAgent);
    const browser = parsedUserAgent.getBrowser();
    const operatingSystem = parsedUserAgent.getOS();
    const device = parsedUserAgent.getDevice();
    const visitorId = await getDailyVisitorId(
        request,
        env,
        input.siteId,
        input.host || "",
        userAgent,
        input.suppliedIp,
    );

    return {
        eventId: crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
        siteId: input.siteId,
        analyticsIndex: await getAnalyticsIndex(input.siteId),
        eventType: input.eventType,
        eventName: input.eventName,
        eventProperties: input.eventProperties || "",
        url: input.url || "",
        host: input.host || "",
        path: input.path || "",
        referrer: input.referrer || "",
        interactive: input.interactive !== false,
        revenueAmount: input.revenueAmount || "",
        revenueCurrency: input.revenueCurrency || "",
        engagementTime: input.engagementTime || 0,
        scrollDepth: input.scrollDepth || 0,
        country: typeof extra.country === "string" ? extra.country : "",
        region: typeof extra.region === "string" ? extra.region : "",
        city: typeof extra.city === "string" ? extra.city : "",
        userAgent,
        browserName: browser.name || "",
        browserVersion: maskBrowserVersion(browser.version) || "",
        operatingSystem: operatingSystem.name || "",
        operatingSystemVersion: operatingSystem.version || "",
        deviceModel: device.model || "",
        deviceType: getDeviceTypeFromDevice(device),
        utmSource: input.utmSource || "",
        utmMedium: input.utmMedium || "",
        utmCampaign: input.utmCampaign || "",
        utmTerm: input.utmTerm || "",
        utmContent: input.utmContent || "",
        visitorId,
        newVisitor:
            input.newVisitor === -1 && !visitorId ? 0 : input.newVisitor || 0,
        newSession: 0,
        bounce: input.bounce || 0,
    };
}

export async function recordNormalizedEvent(
    env: CollectEnv,
    event: NormalizedEvent,
): Promise<void> {
    if (event.eventType !== "engagement") {
        try {
            writeDataPoint(env.WEB_COUNTER_AE, event);
        } catch (error) {
            console.error(
                JSON.stringify({
                    message: "realtime event ingestion failed",
                    eventId: event.eventId,
                    error:
                        error instanceof Error ? error.message : String(error),
                }),
            );
        }
    }

    if (!env.EVENT_STREAM) return;

    const durableEvent: DurableEvent = {
        schema_version: 2,
        event_id: event.eventId,
        received_at: event.receivedAt,
        site_id: event.siteId,
        event_type: event.eventType,
        event_name: event.eventName,
        event_properties: event.eventProperties,
        url: event.url,
        hostname: event.host,
        pathname: event.path,
        referrer: event.referrer,
        interactive: event.interactive,
        revenue_amount: event.revenueAmount,
        revenue_currency: event.revenueCurrency,
        engagement_time: event.engagementTime,
        scroll_depth: event.scrollDepth,
        country: event.country,
        region: event.region,
        city: event.city,
        browser: event.browserName,
        browser_version: event.browserVersion,
        operating_system: event.operatingSystem,
        operating_system_version: event.operatingSystemVersion,
        device_type: event.deviceType,
        device_model: event.deviceModel,
        utm_source: event.utmSource,
        utm_medium: event.utmMedium,
        utm_campaign: event.utmCampaign,
        utm_term: event.utmTerm,
        utm_content: event.utmContent,
        visitor_id: event.visitorId,
    };

    try {
        await env.EVENT_STREAM.send([durableEvent]);
    } catch (error) {
        console.error(
            JSON.stringify({
                message: "durable event ingestion failed",
                eventId: durableEvent.event_id,
                error: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}

const TRACKING_PIXEL_GIF =
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function encodeTrackingPixel(): ArrayBuffer {
    const gifData = atob(TRACKING_PIXEL_GIF);
    const buffer = new ArrayBuffer(gifData.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < gifData.length; i++) {
        view[i] = gifData.charCodeAt(i);
    }
    return buffer;
}

const TRACKING_PIXEL_BUFFER = encodeTrackingPixel();

function trackingPixelResponse({
    dropped,
    nextLastModifiedDate,
}: {
    dropped?: boolean;
    nextLastModifiedDate?: Date;
} = {}): Response {
    const headers: HeadersInit = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "image/gif",
        Expires: "Mon, 01 Jan 1990 00:00:00 GMT",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Tk: "N",
    };

    if (dropped) {
        headers["x-noomers-dropped"] = "1";
    }

    if (nextLastModifiedDate) {
        headers["Last-Modified"] = nextLastModifiedDate.toUTCString();
    }

    return new Response(TRACKING_PIXEL_BUFFER, { headers, status: 200 });
}

function parseEvent(params: Record<string, string>): {
    eventName?: string;
    eventProperties?: string;
    error?: string;
} {
    if (!Object.hasOwn(params, "en")) {
        return Object.hasOwn(params, "ep")
            ? { error: "Event properties require an event name" }
            : {};
    }

    const eventName = params.en.trim();
    if (!eventName || eventName.length > MAX_EVENT_NAME_LENGTH) {
        return { error: "Invalid event name" };
    }

    if (!params.ep) return { eventName };
    if (params.ep.length > MAX_EVENT_PROPERTIES_LENGTH) {
        return { error: "Event properties are too large" };
    }

    try {
        const properties = JSON.parse(params.ep);
        if (
            properties === null ||
            Array.isArray(properties) ||
            typeof properties !== "object" ||
            Object.values(properties).some(
                (value) =>
                    !["string", "number", "boolean"].includes(typeof value),
            )
        ) {
            return { error: "Invalid event properties" };
        }
        return { eventName, eventProperties: JSON.stringify(properties) };
    } catch {
        return { error: "Invalid event properties" };
    }
}

function parseEngagement(
    params: Record<string, string>,
    method: string,
): {
    engagementTime?: number;
    scrollDepth?: number;
    error?: string;
} {
    if (params.et === undefined) {
        return {};
    }

    if (params.et !== "engagement") {
        return { error: "Invalid event type" };
    }

    if (method !== "POST") {
        return { error: "Engagement events must use POST" };
    }

    // Native engagement events do not support a custom event name. A request
    // with custom event name "engagement" remains a custom event only when et
    // is absent and neither e nor sd is present.
    if (
        params.en !== undefined ||
        params.ep !== undefined ||
        params.ht !== undefined
    ) {
        return { error: "Invalid engagement parameters" };
    }

    // Native engagement requires an explicit engagement time. Duration events
    // use e>=1000; scroll-only events must explicitly use e=0 with sd 1..100.
    if (params.e === undefined) {
        return { error: "Invalid engagement parameters" };
    }

    if (!isUnsignedDecimalString(params.e)) {
        return { error: "Invalid engagement time" };
    }

    const engagementTime = Number(params.e);
    const hasSd = params.sd !== undefined;

    if (hasSd && !isUnsignedDecimalString(params.sd)) {
        return { error: "Invalid scroll depth" };
    }
    const scrollDepth = hasSd ? Number(params.sd) : 0;

    if (
        !Number.isInteger(engagementTime) ||
        engagementTime < 0 ||
        engagementTime > MAX_ENGAGEMENT_TIME_MS
    ) {
        return { error: "Invalid engagement time" };
    }

    // Positive engagement time must meet the 1s floor; e=0 is reserved for
    // scroll-only events paired with sd 1..100.
    if (engagementTime > 0 && engagementTime < MIN_ENGAGEMENT_TIME_MS) {
        return { error: "Invalid engagement time" };
    }

    if (hasSd) {
        if (
            !Number.isInteger(scrollDepth) ||
            scrollDepth < 0 ||
            scrollDepth > 100
        ) {
            return { error: "Invalid scroll depth" };
        }
    }

    // e=0 is valid only when a meaningful scroll depth is present.
    if (engagementTime === 0 && (!hasSd || scrollDepth < 1)) {
        return { error: "Invalid engagement parameters" };
    }

    return { engagementTime, scrollDepth };
}

function isUnsignedDecimalString(value: string): boolean {
    return /^[0-9]+$/.test(value);
}

export async function collectRequestHandler(
    request: Request,
    env: CollectEnv,
    extra: Record<string, string> = {}, // extra request properties (i.e. Cloudflare properties)
) {
    const body =
        request.method === "POST" ? await readCollectBody(request) : "";
    if (body === null) {
        return new Response("Request body is too large", { status: 413 });
    }
    const queryParams = extractParamsFromQueryString(request.url);
    const params =
        request.method === "POST"
            ? { ...queryParams, ...extractParams(body) }
            : queryParams;

    const siteId = params.sid;
    if (!siteId || siteId === "") {
        return new Response("Missing siteId", { status: 400 });
    }
    const statusResponse = collectionStatusResponse(
        await getSiteCollectionStatus(env, siteId),
    );
    if (statusResponse) return statusResponse;

    if (shouldDropBot(request)) {
        return trackingPixelResponse({ dropped: true });
    }

    const event = parseEvent(params);
    if (event.error) {
        return new Response(event.error, { status: 400 });
    }

    const engagement = parseEngagement(params, request.method);
    if (engagement.error) {
        return new Response(engagement.error, { status: 400 });
    }

    // Engagement deltas/depth are only meaningful with et=engagement.
    if (
        engagement.engagementTime === undefined &&
        (params.e !== undefined || params.sd !== undefined)
    ) {
        return new Response("Invalid engagement parameters", { status: 400 });
    }

    if (engagement.engagementTime !== undefined) {
        const normalizedEvent = await normalizeEvent(
            request,
            env,
            {
                siteId,
                eventType: "engagement",
                eventName: "engagement",
                eventProperties: "",
                host: params.h,
                path: params.p,
                referrer: params.r,
                interactive: false,
                engagementTime: engagement.engagementTime,
                scrollDepth: engagement.scrollDepth,
                suppliedIp:
                    request.method === "POST" &&
                    params.ip &&
                    params.ip.length <= 45 &&
                    /^[0-9a-f:.]+$/i.test(params.ip)
                        ? params.ip
                        : undefined,
                newVisitor: 0,
                bounce: 0,
                utmSource: params.us,
                utmMedium: params.um,
                utmCampaign: params.uc,
                utmTerm: params.ut,
                utmContent: params.uco,
            },
            extra,
        );

        await recordNormalizedEvent(env, normalizedEvent);

        // Engagement events must not mutate the cache state or trigger an
        // Analytics Engine write; recordNormalizedEvent already skips AE for
        // engagement events and routes only to the durable EVENT_STREAM.
        return trackingPixelResponse();
    }

    // Check if hit type parameter is provided in the request
    // If it is, use it to derive visit and bounce values; otherwise, calculate them using the If-Modified-Since header
    let isVisit = false;
    let bounceValue = 0;
    let nextLastModifiedDate: Date | undefined;
    let hits = 0;

    // Get hit count from params or cache headers
    if (params.ht !== undefined) {
        // From params
        hits = parseInt(params.ht, 10);
        if (isNaN(hits) || hits <= 0) hits = 1;
        if (hits > 3) hits = 3;

        // Don't set nextLastModifiedDate when ht is provided
        nextLastModifiedDate = undefined;
    } else {
        // From cache headers
        const ifModifiedSince = request.headers.get("if-modified-since");
        const cacheResult = handleCacheHeaders(ifModifiedSince);
        hits = cacheResult.hits;
        nextLastModifiedDate = cacheResult.nextLastModifiedDate;
    }

    isVisit = !event.eventName && hits === 1; // custom events do not affect visit metrics

    // Get bounce value based on hit count
    bounceValue = event.eventName ? 0 : getBounceValue(hits);

    const normalizedEvent = await normalizeEvent(
        request,
        env,
        {
            siteId,
            eventType: event.eventName ? "custom" : "pageview",
            eventName: event.eventName || "pageview",
            eventProperties: event.eventProperties,
            host: params.h,
            path: params.p,
            referrer: params.r,
            interactive: true,
            suppliedIp:
                request.method === "POST" &&
                params.ip &&
                params.ip.length <= 45 &&
                /^[0-9a-f:.]+$/i.test(params.ip)
                    ? params.ip
                    : undefined,
            newVisitor: isVisit ? 1 : 0,
            bounce: bounceValue,
            utmSource: params.us,
            utmMedium: params.um,
            utmCampaign: params.uc,
            utmTerm: params.ut,
            utmContent: params.uco,
        },
        extra,
    );

    await recordNormalizedEvent(env, normalizedEvent);

    return trackingPixelResponse({ nextLastModifiedDate });
}

// NOTE: Cloudflare Analytics Engine has limits on total number of bytes, number of fields, etc.
// More here: https://developers.cloudflare.com/analytics/analytics-engine/get-started/#limits

export function writeDataPoint(
    analyticsEngine: AnalyticsEngineDataset,
    data: NormalizedEvent,
) {
    const maxBlobBytes = 16 * 1024;
    const datapoint = {
        indexes: [data.analyticsIndex || ""], // Supply one index
        blobs: [
            data.host || "", // blob1
            "", // blob2 (reserved; raw user agents are not persisted)
            data.path || "", // blob3
            data.country || "", // blob4
            data.referrer || "", // blob5
            data.browserName || "", // blob6
            data.deviceModel || "", // blob7
            data.siteId || "", // blob8
            data.browserVersion || "", // blob9
            data.deviceType || "", // blob10
            data.utmSource || "", // blob11
            data.utmMedium || "", // blob12
            data.utmCampaign || "", // blob13
            data.utmTerm || "", // blob14
            data.utmContent || "", // blob15
            data.eventType === "custom" ? data.eventName : "", // blob16
            data.eventProperties || "", // blob17
            data.visitorId || "", // blob18
        ],
        doubles: [data.newVisitor || 0, data.newSession || 0, data.bounce],
    };

    const size = () =>
        datapoint.blobs.reduce(
            (total, value) =>
                total + new TextEncoder().encode(value).byteLength,
            0,
        );
    for (const index of [16, 4]) {
        if (size() <= maxBlobBytes) break;
        datapoint.blobs[index] = "";
    }
    if (size() > maxBlobBytes) {
        throw new Error("Analytics Engine blob limit exceeded");
    }

    if (!analyticsEngine) {
        // no-op; do not log payload details (paths, referrers, properties, or
        // visitor identifiers are privacy-sensitive)
        console.warn(
            JSON.stringify({
                message: "realtime analytics unavailable; event not recorded",
                eventType: data.eventType,
            }),
        );
        return;
    }

    analyticsEngine.writeDataPoint(datapoint);
}
