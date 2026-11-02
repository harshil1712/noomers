import { secretsEqual } from "../lib/secrets";
import { executeStatsQuery, StatsAPIError } from "../analytics/stats-api";
import type { R2SQLAPI } from "../analytics/r2-sql";
import { SitesRepository } from "../sites/repository";

export function v2MethodNotAllowed() {
    return Response.json(
        { error: "Method Not Allowed" },
        { status: 405, headers: { Allow: "POST" } },
    );
}

/**
 * POST /api/v2/query — the `analytics` accessor is injected so tests can
 * supply a stub R2SQLAPI without touching Basin env config.
 */
export async function handleStatsQuery(
    request: Request,
    env: Env,
    sessionAnalytics: () => R2SQLAPI,
) {
    if (request.method !== "POST") return v2MethodNotAllowed();
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 64 * 1024) {
        return Response.json({ error: "Request body is too large" }, { status: 413 });
    }
    const token = env.STATS_API_TOKEN;
    const authorization = request.headers.get("Authorization");
    if (
        !token ||
        !authorization ||
        !(await secretsEqual(authorization, `Bearer ${token}`))
    ) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
    }
    try {
        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
            return Response.json({ error: "Request body is too large" }, { status: 413 });
        }
        const input = JSON.parse(body);
        const siteId = input && typeof input === "object" && "site_id" in input
            ? input.site_id
            : undefined;
        if (typeof siteId !== "string" || !siteId) {
            throw new StatsAPIError("site_id is required");
        }
        const site = await new SitesRepository(env.DB).get(siteId);
        if (!site) {
            return Response.json({ error: "Site not found" }, { status: 404 });
        }
        return Response.json(await executeStatsQuery(
            sessionAnalytics(),
            { ...input, site_id: site.domain },
            site.timezone,
        ));
    } catch (error) {
        if (error instanceof StatsAPIError || error instanceof SyntaxError) {
            return Response.json({ error: error.message || "Invalid JSON body" }, { status: 400 });
        }
        console.error("Stats API query failed", error);
        return Response.json({ error: "Query failed" }, { status: 500 });
    }
}
