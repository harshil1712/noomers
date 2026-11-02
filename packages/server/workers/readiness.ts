import { requireAPIKey } from "~/api/auth";
import { SitesRepository } from "~/sites/repository";

const BACKLOG_FAIL_MS = 15 * 60 * 1000;
const FRESHNESS_FAIL_MS = 20 * 60 * 1000;
const FRESHNESS_CACHE_MS = 10 * 60 * 1000;

export async function handleReadiness(request: Request, env: Env): Promise<Response> {
    const unauthorized = await requireAPIKey(request, env);
    if (unauthorized) return unauthorized;

    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    const freshnessCandidates: Array<{ site: string; ms: number }> = [];

    try {
        const { sites } = await new SitesRepository(env.GOALS_DB).list();
        checks.d1 = { ok: true };
        const active = sites.filter((site) => !(site as { deleted_at?: string }).deleted_at);


        if (env.SITE_EVENTS) {
            const shippedAges: Array<{ site: string; ms: number }> = [];
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
                    if (backlog.lastShippedAt) {
                        shippedAges.push({
                            site: site.domain,
                            ms: backlog.lastShippedAt,
                        });
                    }
                } catch (e) {
                    checks[`do:${site.domain}`] = { ok: false, detail: String(e) };
                }
            }
            freshnessCandidates.push(
                ...shippedAges.filter(
                    (a) => Date.now() - a.ms > FRESHNESS_FAIL_MS,
                ),
            );
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
            if (res.ok) {
                for (const c of freshnessCandidates) {
                    try {
                        const cacheKey = new Request(
                            `https://noomers-cache.invalid/readiness/max-received/${c.site}`,
                        );
                        const cacheStore =
                            typeof globalThis.caches !== "undefined" &&
                            "default" in globalThis.caches
                                ? (globalThis.caches.default as Cache)
                                : undefined;
                        const hit = cacheStore
                            ? await cacheStore.match(cacheKey)
                            : undefined;
                        if (hit) {
                            const cached = (await hit.json()) as {
                                mx?: string | null;
                            };
                            const mx = cached.mx ? Date.parse(cached.mx) : 0;
                            const behind = c.ms - mx;
                            checks[`freshness:${c.site}`] = {
                                ok: mx > 0 && behind < FRESHNESS_FAIL_MS,
                                detail: `cached basinMax=${cached.mx ?? "none"}`,
                            };
                            continue;
                        }
                        const fRes = await fetch(
                            `https://api.sql.cloudflarestorage.com/api/v1/accounts/${account}/basin-sql/query/${env.R2_SQL_BUCKET}`,
                            {
                                method: "POST",
                                headers: {
                                    Authorization: `Bearer ${env.R2_SQL_TOKEN}`,
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    warehouse: `${account}_${env.R2_SQL_BUCKET}`,
                                    query: `SELECT MAX(TRY_CAST(received_at AS TIMESTAMP)) AS mx FROM ${env.R2_SQL_TABLE} WHERE site_id = '${c.site.replace(/'/g, "''")}'`,
                                }),
                            },
                        );
                        const fJson = (await fRes.json()) as {
                            results?: Array<{ mx?: string | null }>;
                            data?: Array<{ mx?: string | null }>;
                            rows?: Array<{ mx?: string | null }>;
                        };
                        const row =
                            fJson.results?.[0] ?? fJson.data?.[0] ?? fJson.rows?.[0];
                        const mxStr = row?.mx ?? null;
                        if (cacheStore) {
                            await cacheStore.put(
                                cacheKey,
                                new Response(JSON.stringify({ mx: mxStr }), {
                                    headers: {
                                        "content-type": "application/json",
                                        "cache-control": `public, max-age=${FRESHNESS_CACHE_MS / 1000}`,
                                    },
                                }),
                            );
                        }
                        const mx = mxStr ? Date.parse(mxStr) : 0;
                        const behind = c.ms - mx;
                        checks[`freshness:${c.site}`] = {
                            ok: mx > 0 && behind < FRESHNESS_FAIL_MS,
                            detail: `lastShippedAt=${new Date(c.ms).toISOString()} basinMax=${mx ? new Date(mx).toISOString() : "none"}`,
                        };
                    } catch (e) {
                        checks[`freshness:${c.site}`] = {
                            ok: false,
                            detail: String(e),
                        };
                    }
                }
            }
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
