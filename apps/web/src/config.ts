/** Product identity — keep in sync with ../../project.config.ts (the worker
 * bundle can't import from the repo root). */
export const PRODUCT = {
  name: "noomers",
  domain: "noomers.dev",
  appDomain: "app.noomers.dev",
  emailFrom: "noreply@noomers.dev",
} as const;
