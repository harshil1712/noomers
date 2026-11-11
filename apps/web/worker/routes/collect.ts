import { collectRequestHandler, handleCacheHeaders } from "../analytics/collect";
import type { Context } from "hono";

// A client disconnect must not cancel ingest: register the whole handler
// synchronously on entry — the inner awaits happen after registration.
function surviveDisconnect(c: Context<{ Bindings: Env }>, response: Promise<Response>) {
  c.executionCtx.waitUntil(response.catch(() => {}));
  return response;
}

export type CacheLoaderBody = {
  ht: number;
};

/** Native tracker endpoint — own CORS/status behavior lives in collect.ts. */
export function handleCollect(c: Context<{ Bindings: Env }>) {
  return surviveDisconnect(
    c,
    collectRequestHandler(c.req.raw, c.env, c.req.raw.cf as Record<string, string>),
  );
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
