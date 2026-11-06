import { R2SQLAPI } from "../analytics/r2-sql";

export class BasinNotConfiguredError extends Error {
  constructor() {
    super("Basin SQL is not configured (R2_SQL_* env vars missing)");
    this.name = "BasinNotConfiguredError";
  }
}

export function basinConfigured(env: Env): boolean {
  return Boolean(env.R2_SQL_BUCKET && env.R2_SQL_TABLE && env.R2_SQL_TOKEN);
}

/**
 * Lazily-built Basin SQL client for a request. Mirrors the old React Router
 * load-context seam: callers get a stable accessor and Basin work is
 * registered with the execution context.
 */
export function sessionAnalyticsFactory(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
): () => R2SQLAPI {
  let api: R2SQLAPI | undefined;
  return () => {
    if (!basinConfigured(env)) throw new BasinNotConfiguredError();
    api ??= new R2SQLAPI(
      env.CF_ACCOUNT_ID,
      env.R2_SQL_BUCKET!,
      env.R2_SQL_TOKEN!,
      env.R2_SQL_TABLE!,
      fetch,
      env.R2_SQL_IMPORT_TABLE || undefined,
      waitUntil,
    );
    return api;
  };
}
