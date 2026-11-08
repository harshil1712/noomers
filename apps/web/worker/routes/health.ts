import type { Context } from "hono";
import { handleReadiness } from "../readiness";

/** Compatibility liveness response — not proof any backing service is up. */
export function handleHealth() {
  return new Response("ok", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function handleReady(c: Context<{ Bindings: Env }>) {
  return handleReadiness(c.req.raw, c.env);
}
