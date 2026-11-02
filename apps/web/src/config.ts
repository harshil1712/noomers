/** Product identity — keep in sync with ../../project.config.ts (the worker
 * bundle can't import from the repo root). */
export const PRODUCT = {
  name: "noomers",
  domain: "noomers.dev",
  appDomain: "app.noomers.dev",
  emailFrom: "noreply@noomers.dev",
  apiKeyPrefix: "no_",
  api: { publicSpec: false, rateLimitPerMinute: 120 },
} as const;
