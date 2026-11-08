import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import * as Output from "alchemy/Output";
import { fileURLToPath } from "node:url";
import { PROJECT, APP_DOMAIN } from "./project.config";
import eventsSchema from "./apps/web/pipelines/events.schema.json";

const isProd = process.env.ALCHEMY_STAGE === "prod";
// `alchemy dev` marks the process; Basin/Pipeline resources are live-only
// in dev (the R2 bucket is a virtual `dev:<uuid>`), so they're skipped.
const isDev = ["true", "1", "yes", "on"].includes((process.env.ALCHEMY_DEV ?? "").toLowerCase());
const APP_URL = isProd
  ? `https://${APP_DOMAIN}`
  : (process.env.PUBLIC_APP_URL ?? "http://localhost:1338");

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

// Analytics/registry database and R2 warehouse bucket. Physical names are
// Alchemy-generated per stage (app-id-stage-suffix), so stages never adopt
// stray resources. Alchemy keeps applied-migration bookkeeping in its own
// `__alchemy_migrations` table.
const DB = Cloudflare.D1.Database(`${PROJECT.name}-db`, {
  migrations: "./apps/web/migrations",
});

// Basin resources are skipped in local dev: the dev R2 bucket is a
// virtual local `dev:<uuid>` name, and durable history needs a deployed stage.
const WarehouseBucket = isDev ? null : Cloudflare.R2.Bucket(`${PROJECT.name}-warehouse`);
// Managed snapshot expiration physically removes the data files erased rows
// left behind; the maintenance token lets the catalog run that cleanup.
const EventsCatalog = isDev
  ? null
  : Cloudflare.R2.DataCatalog(
      `${PROJECT.name}-events-catalog`,
      Effect.gen(function* () {
        const token = yield* EventsSinkToken!;
        const bucket = yield* WarehouseBucket!;
        return {
          bucket,
          token: token.value,
          snapshotExpiration: {
            state: "enabled" as const,
            maxSnapshotAge: "7d",
            minSnapshotsToKeep: 5,
          },
        };
      }),
    );

// Account API tokens minted by the deploy itself — no hand-managed secrets.
// Minting requires the deploy token to have "Account API Tokens: Edit".
const EventsSinkToken = isDev
  ? null
  : Cloudflare.ApiToken.AccountApiToken(
      `${PROJECT.name}-events-sink-token`,
      Effect.gen(function* () {
        const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
        return {
          accountId,
          policies: [
            {
              effect: "allow" as const,
              permissionGroups: [
                "Workers R2 Data Catalog Write" as const,
                "Workers R2 Storage Write" as const,
              ],
              resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            },
          ],
        };
      }),
    );
const R2SqlToken = isDev
  ? null
  : Cloudflare.ApiToken.AccountApiToken(
      `${PROJECT.name}-r2-sql-token`,
      Effect.gen(function* () {
        const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
        return {
          accountId,
          policies: [
            {
              effect: "allow" as const,
              permissionGroups: [
                "Workers R2 SQL Read" as const,
                "Workers R2 Data Catalog Read" as const,
                "Workers R2 Storage Read" as const,
              ],
              resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            },
          ],
        };
      }),
    );

// Generated secrets — minted once, persisted in alchemy state.
const AuthSecret = Alchemy.Random(`${PROJECT.name}-auth-secret`);
const VisitorSalt = Alchemy.Random(`${PROJECT.name}-visitor-salt`);

// Durable events pipeline: SiteEvents DO → EVENT_STREAM → Iceberg table
// `events` in namespace `noomers` (i.e. `noomers.events`, the default of
// R2_SQL_TABLE). Schema comes from apps/web/pipelines/events.schema.json.
const EventsStream = isDev
  ? null
  : Cloudflare.Pipelines.Stream(`${PROJECT.name}-events-stream`, {
      schema: eventsSchema as Cloudflare.Pipelines.StreamFieldsSchema,
      // No public HTTP ingest — the DO writes via the worker binding only.
      http: false,
    });
const EventsSink = isDev
  ? null
  : Cloudflare.Pipelines.Sink(
      `${PROJECT.name}-events-sink`,
      Effect.gen(function* () {
        const token = yield* EventsSinkToken!;
        const catalog = yield* EventsCatalog!;
        return {
          type: "r2_data_catalog" as const,
          catalog,
          table: { namespace: "noomers", name: "events" },
          token: token.value,
        };
      }),
    );
// Effect props so the pipeline is ordered after its stream and sink —
// a literal SQL string created it concurrently and failed with a 500.
const EventsPipeline = isDev
  ? null
  : Cloudflare.Pipelines.Pipeline(
      `${PROJECT.name}-events-pipeline`,
      Effect.gen(function* () {
        const stream = yield* EventsStream!;
        const sink = yield* EventsSink!;
        return {
          sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${stream.name}`,
        };
      }),
    );

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
const EmailDomain =
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
    const eventsStream = isDev ? null : yield* EventsStream!;
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const warehouseBucket = isDev ? null : yield* WarehouseBucket!;
    const r2SqlToken = isDev ? null : yield* R2SqlToken!;
    // Basin bindings omitted in local dev — the collector keeps realtime
    // events buffered in the DO and Basin SQL is unconfigured.
    const basinEnv: { EVENT_STREAM?: Cloudflare.Pipelines.Stream } = isDev
      ? {}
      : { EVENT_STREAM: eventsStream! };
    const authSecret = yield* AuthSecret;
    const visitorSalt = yield* VisitorSalt;
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
        PUBLIC_APP_URL: APP_URL,
        DB,
        SITE_EVENTS: Cloudflare.DurableObject("SiteEvents"),
        ...basinEnv,
        EMAIL: Cloudflare.Email.SendEmail("email"),
        // Auth-endpoint throttle (per-IP).
        RATE_LIMITER: Cloudflare.RateLimit("RATE_LIMITER", {
          namespaceId: 1002,
          simple: { limit: 60, period: 60 },
        }),
        // Per-IP throttle on /collect and /api/event — namespace 1001.
        COLLECT_RATE_LIMIT: Cloudflare.RateLimit("COLLECT_RATE_LIMIT", {
          namespaceId: 1001,
          simple: { limit: 100, period: 60 },
        }),
        TURNSTILE_SECRET_KEY: widget ? widget.secret : "1x0000000000000000000000000000000AA",
        TURNSTILE_SITE_KEY: widget ? widget.sitekey : "1x00000000000000000000AA",
        BETTER_AUTH_SECRET: authSecret.text,
        BETTER_AUTH_URL: Config.Redacted("BETTER_AUTH_URL").pipe(Config.withDefault(APP_URL)),
        GOOGLE_CLIENT_ID: Config.Redacted("GOOGLE_CLIENT_ID").pipe(Config.withDefault("")),
        GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET").pipe(Config.withDefault("")),
        OWNER_ADMIN_EMAIL: Config.String("OWNER_ADMIN_EMAIL").pipe(Config.withDefault("")),
        SIGNUP_DISABLED: Config.String("SIGNUP_DISABLED").pipe(Config.withDefault("")),
        OAUTH_PROXY_URL: Config.String("OAUTH_PROXY_URL").pipe(Config.withDefault("")),
        OAUTH_PROXY_SECRET: Config.Redacted("OAUTH_PROXY_SECRET").pipe(Config.withDefault("")),

        // --- noomers analytics core --------------------------------------
        // Daily-rotating visitor-id salt; required for /collect and
        // /api/event — the collector refuses traffic without it.
        VISITOR_SALT: visitorSalt.text,
        // Bearer tokens for the Plausible-compat APIs.
        SITES_API_TOKEN: Config.Redacted("SITES_API_TOKEN").pipe(Config.withDefault("")),
        STATS_API_TOKEN: Config.Redacted("STATS_API_TOKEN").pipe(Config.withDefault("")),
        // First-party server tracker token (optional).
        SERVER_EVENTS_TOKEN: Config.Redacted("SERVER_EVENTS_TOKEN").pipe(Config.withDefault("")),
        CF_ACCOUNT_ID: accountId,
        CF_TRACKER_SCRIPT_NAME: Config.String("CF_TRACKER_SCRIPT_NAME").pipe(
          Config.withDefault(""),
        ),
        // Basin SQL warehouse — bound from the provisioned bucket/token.
        R2_SQL_BUCKET: warehouseBucket ? warehouseBucket.bucketName : "",
        R2_SQL_TABLE: Config.String("R2_SQL_TABLE").pipe(Config.withDefault("noomers.events")),
        R2_SQL_IMPORT_TABLE: Config.String("R2_SQL_IMPORT_TABLE").pipe(Config.withDefault("")),
        R2_SQL_TOKEN: r2SqlToken ? r2SqlToken.value : "",
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
    PUBLIC_APP_URL: APP_URL,
  },
});

export default Alchemy.Stack(
  PROJECT.name,
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // The pipeline resources and email domain aren't referenced by a binding,
    // so yield them explicitly — unyielded resource Effects are never applied.
    if (!isDev) {
      yield* EventsSink!;
      yield* EventsPipeline!;
    }
    if (EmailDomain) yield* EmailDomain;
    const web = yield* Web;
    const site = yield* Site;
    return { url: web.url, siteUrl: site.url };
  }),
);
