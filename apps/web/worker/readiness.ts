import { requireAPIKey } from "./api/auth";
import { SitesRepository } from "./sites/repository";

export async function handleReadiness(request: Request, env: Env): Promise<Response> {
  const unauthorized = await requireAPIKey(request, env);
  if (unauthorized) return unauthorized;

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await new SitesRepository(env.DB).list();
    checks.d1 = { ok: true };
  } catch (e) {
    checks.d1 = { ok: false, detail: String(e) };
  }

  if (env.R2_SQL_TOKEN && env.R2_SQL_BUCKET) {
    try {
      const account = env.CF_ACCOUNT_ID;
      const res = await fetch(
        `https://api.sql.cloudflarestorage.com/api/v1/accounts/${account}/basin-sql/query/${env.R2_SQL_BUCKET}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.R2_SQL_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            warehouse: `${account}_${env.R2_SQL_BUCKET}`,
            query: "SHOW TABLES IN noomers",
          }),
        },
      );
      checks.basin = { ok: res.ok, detail: `status ${res.status}` };
    } catch (e) {
      checks.basin = { ok: false, detail: String(e) };
    }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ status: ok ? "ready" : "degraded", checks }, { status: ok ? 200 : 503 });
}
