/** Single source for names/domains — alchemy.run.ts, the apps and
 * scripts/init.ts all read from here. `vpx scripts/init.ts` rewrites it. */
export const PROJECT = {
  /** Repo + worker name prefix: <name>-web, <name>-site, <name>-db. */
  name: "noomers",
  /** Product name used in UI copy and email subjects. */
  productName: "noomers",
  /** Cloudflare zone apex. */
  domain: "noomers.dev",
  /** Subdomain the app runs on (site lives on the apex). */
  appSubdomain: "app",
  /** From: address for auth emails (verify, reset). */
  emailFrom: "noreply@noomers.dev",
  /** Human-monitored inbox for support + privacy/data requests (site privacy page). */
  supportEmail: "support@noomers.dev",
  /** API key prefix — keys are shown once and identified in lists by it. */
  apiKeyPrefix: "no_",
  /** Agent API (/api/v1 + /mcp). publicSpec exposes openapi.json + discovery
   * without a key; rateLimitPerMinute is the per-key ceiling. */
  api: { publicSpec: false, rateLimitPerMinute: 120 },
} as const;

export const APP_DOMAIN = `${PROJECT.appSubdomain}.${PROJECT.domain}`;
