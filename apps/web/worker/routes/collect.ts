import { collectRequestHandler } from "../analytics/collect";
import { plausibleEventRequestHandler } from "../analytics/plausible";
import { handleCacheHeaders } from "../analytics/collect";
import type { Context } from "hono";

export type CacheLoaderBody = {
    ht: number;
};

/** Native tracker endpoint — own CORS/status behavior lives in collect.ts. */
export function handleCollect(c: Context<{ Bindings: Env }>) {
    return collectRequestHandler(c.req.raw, c.env, c.req.raw.cf as Record<string, string>);
}

/** Plausible-compatible /api/event — POST + OPTIONS handled internally. */
export function handlePlausibleEvent(c: Context<{ Bindings: Env }>) {
    return plausibleEventRequestHandler(
        c.req.raw,
        c.env,
        c.req.raw.cf as Record<string, string>,
    );
}

export function handlePlausibleEventMethodNotAllowed() {
    return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
    });
}

/**
 * /cache — evaluates If-Modified-Since to report hits within the current
 * session, based on the cookieless tracking logic.
 */
export function handleCache(c: Context<{ Bindings: Env }>) {
    const ifModifiedSince = c.req.header("if-modified-since") ?? null;
    const { hits, nextLastModifiedDate } = handleCacheHeaders(ifModifiedSince);
    const payload = { ht: hits } satisfies CacheLoaderBody;
    return new Response(JSON.stringify(payload), {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
            "Last-Modified": nextLastModifiedDate.toUTCString(),
            Expires: "Mon, 01 Jan 1990 00:00:00 GMT",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Tk: "N", // not tracking
        },
    });
}
