import { createMiddleware } from "hono/factory";

/**
 * Per-IP throttle on auth mutations — Better Auth credential endpoints are
 * the brute-force surface. Keyed by cf-connecting-ip; "unknown" bucket for
 * local/test requests without the header.
 */
export const authRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const key = c.req.header("cf-connecting-ip") ?? "unknown";
  const { success } = await c.env.RATE_LIMITER.limit({ key });
  if (!success) return c.json({ error: "too many requests" }, 429);
  await next();
});
