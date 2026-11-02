/** Worker bindings — mirrors the `env` block in alchemy.run.ts. `alchemy dev`
 * can regenerate this file (Cloudflare.InferEnv<typeof Web>); keep it in sync
 * by hand until then. */
interface Env {
  DB: D1Database;
  RATE_LIMITER: RateLimit;
  /** Per-IP throttle on /collect. */
  COLLECT_RATE_LIMIT?: RateLimit;
  /** Per-site realtime/durable event buffer. */
  SITE_EVENTS?: DurableObjectNamespace<import("./site-events").SiteEvents>;
  /** Basin Pipeline stream the SiteEvents DO ships durable events to. */
  EVENT_STREAM?: import("cloudflare:pipelines").Pipeline;
  /** Static assets (SPA + tracker.js). */
  ASSETS: Fetcher;
  /** Cloudflare Email send_email binding — prod/local .eml simulator. */
  EMAIL?: SendEmail;
  /** Test seam: when bound, outbound mail is POSTed here as JSON instead of
   * going through EMAIL. Bound only by the vitest miniflare config. */
  EMAIL_SINK?: Fetcher;
  /** Test seam: D1 migrations read by `readD1Migrations` in vite.config.ts;
   * applied with `applyD1Migrations` in tests. */
  TEST_MIGRATIONS?: import("cloudflare:test").D1Migration[];
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OWNER_ADMIN_EMAIL: string;
  /** "true" closes new sign-ups (email + Google); existing accounts still sign in. */
  SIGNUP_DISABLED?: string;
  OAUTH_PROXY_URL?: string;
  OAUTH_PROXY_SECRET?: string;

  // --- noomers analytics core ------------------------------------------------
  /** Daily-rotating salt for visitor identifiers. */
  VISITOR_SALT?: string;
  /** Bearer token for the Plausible Sites API (/api/v1/*). */
  SITES_API_TOKEN?: string;
  /** Bearer token for the Stats API (/api/v2/query); fallback for /api/v1. */
  STATS_API_TOKEN?: string;
  /** First-party server tracker token (SERVER-EVENTS header auth). */
  SERVER_EVENTS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  /** Optional custom name for the served tracker script (<name>.js). */
  CF_TRACKER_SCRIPT_NAME?: string;
  /** Basin SQL warehouse/table config — absent means Basin is not configured. */
  R2_SQL_BUCKET?: string;
  R2_SQL_TABLE?: string;
  R2_SQL_IMPORT_TABLE?: string;
  R2_SQL_TOKEN?: string;
}
