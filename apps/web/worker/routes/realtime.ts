import type { Context } from "hono";
import { handleRealtime } from "../realtime";

export function handleRealtimeRoute(c: Context<{ Bindings: Env }>) {
    return handleRealtime(c.req.raw, c.env, new URL(c.req.url));
}
