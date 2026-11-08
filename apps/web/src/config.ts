/** Product identity — keep in sync with ../../project.config.ts (the worker
 * bundle can't import from the repo root). */
export const PRODUCT = {
  name: "noomers",
  domain: "noomers.com",
  appDomain: "app.noomers.com",
  emailFrom: "noreply@noomers.com",
} as const;
