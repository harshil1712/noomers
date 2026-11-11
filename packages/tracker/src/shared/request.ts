import type {
    CollectRequestParams,
    CustomEventOptions,
    EventProperties,
    UtmParams,
} from "./types";
import { queryParamStringify } from "./utils";

const MAX_EVENT_PROPERTIES_LENGTH = 2048;

function serializeEventProperties(props: EventProperties): string {
    if (
        Object.values(props).some(
            (value) =>
                !["string", "number", "boolean"].includes(typeof value) ||
                (typeof value === "number" && !Number.isFinite(value)),
        )
    ) {
        throw new Error(
            "Event properties must be strings, finite numbers, or booleans.",
        );
    }

    const serialized = JSON.stringify(props);
    if (serialized.length > MAX_EVENT_PROPERTIES_LENGTH) {
        throw new Error("Event properties must not exceed 2048 characters.");
    }
    return serialized;
}

export function buildCollectRequestParams(
    siteId: string,
    hostname: string,
    path: string,
    referrer: string,
    utmParams: UtmParams = {},
    hitType?: string,
    event?: CustomEventOptions,
    ip?: string,
): CollectRequestParams {
    const params: CollectRequestParams = {
        p: path,
        h: hostname,
        r: referrer,
        sid: siteId,
    };

    if (hitType) {
        params.ht = hitType;
    }

    if (event) {
        params.en = event.name;
        if (event.props && Object.keys(event.props).length > 0) {
            params.ep = serializeEventProperties(event.props);
        }
        if (event.revenue) {
            params.ra = String(event.revenue.amount);
            params.rc = event.revenue.currency.toUpperCase();
        }
        if (event.interactive === false) {
            params.ni = "1";
        }
    }

    if (ip) {
        params.ip = ip;
    }

    Object.assign(params, utmParams);

    return params;
}

export function buildEngagementRequestParams(
    siteId: string,
    hostname: string,
    path: string,
    referrer: string,
    engagementTime: number,
    scrollDepth = 0,
): CollectRequestParams {
    const params: CollectRequestParams = {
        p: path,
        h: hostname,
        r: referrer,
        sid: siteId,
        et: "engagement",
        e: String(Math.floor(engagementTime)),
    };

    if (scrollDepth > 0) {
        params.sd = String(Math.floor(scrollDepth));
    }

    return params;
}

export function buildCollectUrl(
    baseUrl: string,
    params: CollectRequestParams,
    filterEmpty = false,
): string {
    return baseUrl + queryParamStringify(params, filterEmpty);
}
