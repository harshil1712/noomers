import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { SPA_CSP } from "./security-headers";
import { requestIdMiddleware } from "./middleware/request-id";
import { authRateLimit } from "./middleware/rate-limit";
import { createAuth } from "./auth";
import { publicConfigRoutes } from "./routes/public-config";
import { meRoutes } from "./routes/me";
import {
  handleCollect,
  handlePlausibleEvent,
  handlePlausibleEventMethodNotAllowed,
  handleCache,
} from "./routes/collect";
import { handleHealth, handleReady } from "./routes/health";
import { handleRealtimeRoute } from "./routes/realtime";
import { handleTrackerScript, handlePlausibleScript } from "./routes/scripts";
import { handleFavicon } from "./routes/favicon";
import { sitesApi } from "./routes/v1-sites";
import { handleStatsQuery, v2MethodNotAllowed } from "./routes/v2-query";
import { sessionAnalyticsFactory } from "./lib/context";
import { SiteEvents } from "./site-events";

export { SiteEvents };

const app = new Hono<{ Bindings: Env }>();

// Request id first — the error handler and every route can read it.
app.use("*", requestIdMiddleware);

// Security headers + SPA CSP apply only to the auth/app surface. Analytics
// endpoints (/collect, /api/event, /api/v1, /api/v2, tracker scripts, cache,
// favicon, realtime) own their headers — tracker scripts must stay loadable
// cross-origin and collect/event carry their own CORS contract.
const SECURED_PREFIXES = ["/api/auth/", "/api/me", "/api/public-config"];
app.use("*", async (c, next) => {
  if (!SECURED_PREFIXES.some((p) => c.req.path.startsWith(p))) return next();
  return secureHeaders({
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    permissionsPolicy: { camera: false, microphone: false, geolocation: false },
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })(c, async () => {
    await next();
    c.header("Content-Security-Policy", SPA_CSP);
  });
});

app.onError((err, c) => {
  // Log the real failure for operators — never echo internals to clients.
  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId"),
      path: c.req.path,
      method: c.req.method,
      message: err.message,
    }),
  );
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

// --- Analytics collection & compat endpoints -------------------------------
app.get("/api/health", handleHealth);
app.get("/api/health/ready", handleReady);
app.get("/realtime/:siteId", handleRealtimeRoute);

// Every method goes through the collector — the old action handler did the
// same for non-GET requests.
app.all("/collect", handleCollect);

app.on(["POST", "OPTIONS"], "/api/event", handlePlausibleEvent);
app.all("/api/event", handlePlausibleEventMethodNotAllowed);

// --- Plausible Sites API (v1) ----------------------------------------------
app.route("/", sitesApi);

// --- Stats API (v2) ----------------------------------------------------------
app.post("/api/v2/query", (c) =>
  handleStatsQuery(c.req.raw, c.env, sessionAnalyticsFactory(c.env, (p) => c.executionCtx.waitUntil(p))),
);
app.all("/api/v2/query", v2MethodNotAllowed);

// --- Tracker scripts --------------------------------------------------------
app.get("/js/:script", (c) => handlePlausibleScript(c.req.raw, c.env, c.req.param("script")));
app.get("/:script{[^/]+\\.js$}", (c) => handleTrackerScript(c.req.raw, c.env, c.req.param("script")));

// --- Misc ----------------------------------------------------------------------
app.get("/favicon", (c) => handleFavicon(c.req.raw, (p) => c.executionCtx.waitUntil(p)));
app.get("/cache", handleCache);

// --- Dashboard app surface ----------------------------------------------------
app.route("/", publicConfigRoutes);
app.route("/", meRoutes);

// Better Auth handler — catches all /api/auth/* requests (sign-in, sign-up,
// email verification, reset, admin plugin endpoints, OAuth callbacks).
// Mutations are IP-rate-limited (brute-force surface).
app.use("/api/auth/*", async (c, next) => {
  if (c.req.method === "POST") return authRateLimit(c, next);
  await next();
});
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const res = await createAuth(c.env).handler(c.req.raw);
  // Copy before mutation — the handler's response headers are immutable.
  return new Response(res.body, res);
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;
