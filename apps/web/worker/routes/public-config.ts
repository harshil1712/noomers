import { Hono } from "hono";
import { signupOpen } from "../signup";

/** Unauthenticated feature flags for the SPA — mirrors the auth.ts gate: the
 * "Continue with Google" button and the Turnstile widget render only when the
 * server is configured for them. */
export const publicConfigRoutes = new Hono<{ Bindings: Env }>();

publicConfigRoutes.get("/api/public-config", async (c) =>
  c.json({
    googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID?.trim() && c.env.GOOGLE_CLIENT_SECRET?.trim()),
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
    signupEnabled: await signupOpen(c.env),
  }),
);
