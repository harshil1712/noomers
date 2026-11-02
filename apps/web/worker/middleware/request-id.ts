import { createMiddleware } from "hono/factory";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

/**
 * Per-request id for log correlation — registered first so the error handler
 * and downstream handlers can read it. Sets X-Request-ID on the response.
 */
export const requestIdMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);
  await next();
  c.header("X-Request-ID", id);
});
