import { z } from "zod";
import { secretsEqual } from "../lib/secrets";
import { executeStatsQuery, StatsAPIError } from "../analytics/stats-api";
import type { R2SQLAPI } from "../analytics/r2-sql";
import { SitesRepository } from "../sites/repository";
import { GoalsRepository } from "../goals/repository";

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
  if (!token || !authorization || !(await secretsEqual(authorization, `Bearer ${token}`))) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
      return Response.json({ error: "Request body is too large" }, { status: 413 });
    }
    const parsed = z.looseObject({ site_id: z.string().min(1) }).safeParse(JSON.parse(body));
    if (!parsed.success) {
      throw new StatsAPIError("site_id is required");
    }
    const input = parsed.data;
    const site = await new SitesRepository(env.DB).get(input.site_id);
    if (!site) {
      return Response.json({ error: "Site not found" }, { status: 404 });
    }
    return Response.json(
      await executeStatsQuery(
        sessionAnalytics(),
        { ...input, site_id: site.domain },
        site.timezone,
        await new GoalsRepository(env.DB).list(site.domain),
      ),
    );
  } catch (error) {
    if (error instanceof StatsAPIError || error instanceof SyntaxError) {
      return Response.json({ error: error.message || "Invalid JSON body" }, { status: 400 });
    }
    console.error("Stats API query failed", error);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }
}
