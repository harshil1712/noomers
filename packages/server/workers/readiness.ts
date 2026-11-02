import { requireAPIKey } from "~/api/auth";
import { SitesRepository } from "~/sites/repository";

const BACKLOG_FAIL_MS = 15 * 60 * 1000;
const FRESHNESS_FAIL_MS = 20 * 60 * 1000;
const FRESHNESS_CACHE_MS = 10 * 60 * 1000;

export async function handleReadiness(request: Request, env: Env): Promise<Response> {
    const unauthorized = await requireAPIKey(request, env);
    if (unauthorized) return unauthorized;

    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
        const { sites } = await new SitesRepository(env.GOALS_DB).list();
        checks.d1 = { ok: true };
        const active = sites.filter((site) => !(site as { deleted_at?: string }).deleted_at);

        if (env.SITE_EVENTS) {
            for (const site of active) {
                try {
                    const backlog = await env.SITE_EVENTS
                        .get(env.SITE_EVENTS.idFromName(site.domain))
                        .backlog();
                    const stale = backlog.oldestUnshippedAgeMs > BACKLOG_FAIL_MS;
                    checks[`do:${site.domain}`] = {
                        ok: !stale,
                        detail: `unshipped=${backlog.unshipped} oldest=${backlog.oldestUnshippedAgeMs}ms failures=${backlog.sendFailures}`,
                    };
                } catch (e) {
                    checks[`do:${site.domain}`] = { ok: false, detail: String(e) };
                }
            }
        }
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
    return Response.json(
        { status: ok ? "ready" : "degraded", checks },
        { status: ok ? 200 : 503 },
    );
}
