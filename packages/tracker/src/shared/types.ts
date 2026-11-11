export type CollectRequestParams = {
    p: string; // path
    h: string; // host
    r: string; // referrer
    sid: string; // siteId
    ht?: string; // hit type
    en?: string; // custom event name; absent for pageviews
    ep?: string; // JSON-encoded custom event properties
    ra?: string; // revenue amount; custom events only, requires rc
    rc?: string; // revenue currency (ISO-4217); custom events only, requires ra
    et?: string; // native event type; "engagement" for engagement events
    e?: string; // engagement time in milliseconds (delta, not cumulative)
    sd?: string; // scroll depth 0-100
    ip?: string; // optional server-side source IP; never persisted
    [key: string]: string | undefined; // Allow additional string properties
} & UtmParams;

export type EventProperty = string | number | boolean;
export type EventProperties = Record<string, EventProperty>;

export type EventRevenue = {
    amount: number | string;
    currency: string;
};

export type CustomEventOptions = {
    name: string;
    props?: EventProperties;
    revenue?: EventRevenue;
};

export type UtmParams = {
    us?: string; // utm_source
    um?: string; // utm_medium
    uc?: string; // utm_campaign
    ut?: string; // utm_term
    uco?: string; // utm_content
};

export type HostnameAndPath = {
    hostname: string;
    path: string;
};

export type BaseClientConfig = {
    siteId: string;
    reporterUrl: string;
    reportOnLocalhost?: boolean;
};

export type CacheResponse = {
    ht: number; // Number of hits in the current session (hit type)
};
