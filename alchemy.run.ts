import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import { fileURLToPath } from "node:url";
import { PROJECT, APP_DOMAIN } from "./project.config";
import eventsSchema from "./apps/web/pipelines/events.schema.json";

const isProd = process.env.ALCHEMY_STAGE === "prod";

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

// Analytics/registry database. `name` matches the existing production D1
// ("noomers-goals") so the stack reuses it instead of creating a second DB.
// Alchemy keeps applied-migration bookkeeping in its own
// `__alchemy_migrations` table; a DB previously migrated by
// `wrangler d1 migrations apply` (the `d1_migrations` table) is converted
// one-way on first deploy — the wrangler table is left frozen, and 0001–0007
// are never re-applied.
const DB = Cloudflare.D1.Database(`${PROJECT.name}-db`, {
  name: "noomers-goals",
  migrations: "./apps/web/migrations",
});

// R2 warehouse bucket for durable events + its Basin (Iceberg) Data Catalog.
const WarehouseBucket = Cloudflare.R2.Bucket(`${PROJECT.name}-warehouse`, {
  name: `${PROJECT.name}-events`,
});
const EventsCatalog = Cloudflare.R2.DataCatalog(`${PROJECT.name}-events-catalog`, {
  bucket: WarehouseBucket,
});

// Durable events pipeline: SiteEvents DO → EVENT_STREAM → Iceberg table
// `events` in namespace `noomers` (i.e. `noomers.events`, the default of
// R2_SQL_TABLE). Schema comes from apps/web/pipelines/events.schema.json.
const EventsStream = Cloudflare.Pipelines.Stream(`${PROJECT.name}-events-stream`, {
  name: "noomers_events_stream",
  schema: eventsSchema as Cloudflare.Pipelines.StreamFieldsSchema,
  // No public HTTP ingest — the DO writes via the worker binding only.
  http: false,
});
const EventsSink = Cloudflare.Pipelines.Sink(`${PROJECT.name}-events-sink`, {
  name: "noomers_events_sink",
  type: "r2_data_catalog",
  catalog: EventsCatalog,
  table: { namespace: "noomers", name: "events" },
  // Cloudflare API token with R2 Data Catalog write permission.
  token: Config.Redacted("R2_CATALOG_TOKEN"),
});
const EventsPipeline = Cloudflare.Pipelines.Pipeline(`${PROJECT.name}-events-pipeline`, {
  name: "noomers_events_pipeline",
  sql: `INSERT INTO noomers_events_sink SELECT * FROM noomers_events_stream`,
});

// Turnstile widget — prod only; every other stage uses Cloudflare's
// always-pass test pair so previews/e2e/local dev stay automatable.
const TurnstileWidget = isProd
  ? Cloudflare.Turnstile.Widget(`${PROJECT.name}-turnstile`, {
      domains: [APP_DOMAIN],
      mode: "managed",
    })
  : null;

// Email sending domain on the zone — prod only. Local dev uses alchemy's
// .eml simulator (.alchemy/local/email), previews send nothing real.
// Zone id comes from CLOUDFLARE_ZONE_ID (or a zone lookup) — never hardcode it.
const _EmailDomain =
  isProd && process.env.CLOUDFLARE_ZONE_ID
    ? Cloudflare.Email.SendingSubdomain(`${PROJECT.name}-email`, {
        zoneId: process.env.CLOUDFLARE_ZONE_ID,
        name: PROJECT.domain,
      })
    : null;

// Per-PR Worker Previews: with PR_NAME set each Worker is uploaded as a
// preview version *of* its production self (parent deployment untouched).
const PREVIEW_NAME = process.env.PR_NAME ?? "";

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

// Props given as an Effect so the Turnstile widget resolves first — its
// secret/sitekey are only known after the resource applies.
export const Web = Cloudflare.Website.Vite(
  `${PROJECT.name}-web`,
  Effect.gen(function* () {
    const widget = isProd ? yield* TurnstileWidget! : null;
    const eventsStream = yield* EventsStream;
    return {
      // a Preview inherits script-level settings (name, domain) from its parent
      name: PREVIEW_NAME ? undefined : `${PROJECT.name}-web`,
      rootDir: "./apps/web",
      main: "./worker/index.ts",
      // Pin the runtime date explicitly. `nodejs_compat` is on by default
      // for dates ≥ 2026-08-04, and passing the flag with an undated (=newer)
      // default makes workerd throw "nodejs_compat became the default", so
      // don't list it. If you lower the date below 2026-08-04, add
      // `flags: ["nodejs_compat"]` back (better-auth + node:crypto need it).
      dev: { port: 1338, strictPort: true },
      compatibility: { date: "2026-10-01" },
      // Workers Observability: logs + traces (span-level view of subrequests).
      observability: {
        enabled: true,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
      // Custom domains only on the prod stage — dev/preview stages run on
      // workers.dev preview URLs and must never claim the zone.
      domain: isProd && !PREVIEW_NAME ? { name: APP_DOMAIN } : undefined,
      preview: PREVIEW_NAME ? { of: `${PROJECT.name}-web`, name: PREVIEW_NAME } : undefined,
      assets: {
        notFoundHandling: "single-page-application" as const,
        // Every non-asset path the worker owns. "/*.js" keeps the
        // configurable CF_TRACKER_SCRIPT_NAME (<name>.js) worker-routed.
        runWorkerFirst: [
          "/api/*",
          "/collect",
          "/realtime/*",
          "/js/*",
          // Cloudflare `*` crosses `/`, so "/*.js" would also swallow
          // /assets/*.js (the SPA bundle) — exclude it; the Hono
          // catch-all below still falls back to assets if it slips.
          "/*.js",
          "!/assets/*",
          "/favicon",
          "/cache",
        ],
      },
      env: {
        PUBLIC_APP_URL: "https://" + APP_DOMAIN,
        DB,
        SITE_EVENTS: Cloudflare.DurableObject("SiteEvents"),
        EVENT_STREAM: eventsStream,
        EMAIL: Cloudflare.Email.SendEmail("email"),
        // Auth-endpoint throttle (per-IP).
        RATE_LIMITER: Cloudflare.RateLimit("RATE_LIMITER", {
          namespaceId: 1002,
          simple: { limit: 60, period: 60 },
        }),
        // Per-IP throttle on /collect — namespace 1001 matches the
        // wrangler-era binding already in production.
        COLLECT_RATE_LIMIT: Cloudflare.RateLimit("COLLECT_RATE_LIMIT", {
          namespaceId: 1001,
          simple: { limit: 100, period: 60 },
        }),
        TURNSTILE_SECRET_KEY: widget ? widget.secret : "1x0000000000000000000000000000000AA",
        TURNSTILE_SITE_KEY: widget ? widget.sitekey : "1x00000000000000000000AA",
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
        BETTER_AUTH_URL: Config.Redacted("BETTER_AUTH_URL").pipe(
          Config.withDefault(isProd ? `https://${APP_DOMAIN}` : "http://localhost:1338"),
        ),
        GOOGLE_CLIENT_ID: Config.Redacted("GOOGLE_CLIENT_ID").pipe(Config.withDefault("")),
        GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET").pipe(Config.withDefault("")),
        OWNER_ADMIN_EMAIL: Config.String("OWNER_ADMIN_EMAIL").pipe(Config.withDefault("")),
        SIGNUP_DISABLED: Config.String("SIGNUP_DISABLED").pipe(Config.withDefault("")),
        OAUTH_PROXY_URL: Config.String("OAUTH_PROXY_URL").pipe(Config.withDefault("")),
        OAUTH_PROXY_SECRET: Config.Redacted("OAUTH_PROXY_SECRET").pipe(Config.withDefault("")),

        // --- noomers analytics core --------------------------------------
        // Daily-rotating visitor-id salt; required for /collect and
        // /api/event — the collector refuses traffic without it.
        VISITOR_SALT: Config.Redacted("VISITOR_SALT"),
        // Bearer tokens for the Plausible-compat APIs.
        SITES_API_TOKEN: Config.Redacted("SITES_API_TOKEN").pipe(Config.withDefault("")),
        STATS_API_TOKEN: Config.Redacted("STATS_API_TOKEN").pipe(Config.withDefault("")),
        // First-party server tracker token (optional).
        SERVER_EVENTS_TOKEN: Config.Redacted("SERVER_EVENTS_TOKEN").pipe(Config.withDefault("")),
        CF_ACCOUNT_ID: Config.String("CF_ACCOUNT_ID").pipe(Config.withDefault("")),
        CF_TRACKER_SCRIPT_NAME: Config.String("CF_TRACKER_SCRIPT_NAME").pipe(
          Config.withDefault(""),
        ),
        // Basin SQL warehouse — empty means Basin is not configured and the
        // Stats API / readiness checks report "not configured".
        R2_SQL_BUCKET: Config.String("R2_SQL_BUCKET").pipe(Config.withDefault("")),
        R2_SQL_TABLE: Config.String("R2_SQL_TABLE").pipe(Config.withDefault("noomers.events")),
        R2_SQL_IMPORT_TABLE: Config.String("R2_SQL_IMPORT_TABLE").pipe(Config.withDefault("")),
        R2_SQL_TOKEN: Config.Redacted("R2_SQL_TOKEN").pipe(Config.withDefault("")),
      },
    };
  }),
);

export type WorkerEnv = Cloudflare.InferEnv<typeof Web>;

// Static marketing site on the apex; www 301s to apex. Prod only for the
// custom domain — previews run under preview URLs.
export const Site = Cloudflare.Website.Astro(`${PROJECT.name}-site`, {
  name: PREVIEW_NAME ? undefined : `${PROJECT.name}-site`,
  // Absolute: the dev child spawns with cwd=rootDir; a relative path would
  // resolve twice (apps/site/apps/site) and astro loses src/pages.
  rootDir: fileURLToPath(new URL("./apps/site", import.meta.url)),
  // static site: no Astro sessions, so no auto-provisioned KV namespace
  sessionKVBindingName: false,
  domain:
    isProd && !PREVIEW_NAME
      ? { name: PROJECT.domain, redirects: [`www.${PROJECT.domain}`] }
      : undefined,
  preview: PREVIEW_NAME ? { of: `${PROJECT.name}-site`, name: PREVIEW_NAME } : undefined,
  dev: { port: 1337, strictPort: true },
  env: {
    PUBLIC_APP_URL: isProd ? `https://${APP_DOMAIN}` : "http://localhost:1338",
  },
});

export default Alchemy.Stack(
  PROJECT.name,
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // The pipeline resources aren't referenced by a binding, so yield them
    // explicitly — unreferenced resource Effects are never applied.
    yield* EventsSink;
    yield* EventsPipeline;
    const web = yield* Web;
    const site = yield* Site;
    return { url: web.url, siteUrl: site.url };
  }),
);
