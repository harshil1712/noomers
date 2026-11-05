import { z } from "zod";
import { Hono } from "hono";
import { createAuth } from "../auth";
import { sessionAnalyticsFactory } from "../lib/context";
import {
  getDateTimeRange,
  getFiltersFromSearchParams,
  getIntervalType,
  paramsFromUrl,
} from "../lib/utils";
import type { R2SQLAPI, SessionDimension, SessionMetricsRow } from "../analytics/r2-sql";
import { SitesRepository } from "../sites/repository";
import { GoalsRepository, type GoalType } from "../goals/repository";

const PAGE_SIZE = 10;

/** [dimension, visitors, secondary metric] tuples. */
export type CountRow =
  | [string | [string, string], number, number]
  | [string | [string, string], number];

export type Analytics = () => R2SQLAPI;

export type Ctx = {
  env: Env;
  sessionAnalytics: Analytics;
};

async function siteTimezone(env: Env, site: string): Promise<string> {
  try {
    return (await new SitesRepository(env.DB).get(site))?.timezone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

function searchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

/** Shared body for the breakdown cards. */
async function breakdown(
  c: Ctx,
  request: Request,
  dimension: SessionDimension,
  metric: "visitors" | "visits" | "views" | "events",
  transform?: (rows: CountRow[]) => CountRow[],
  extraParams?: Record<string, string>,
) {
  const { interval = "7d", site, page = 1 } = paramsFromUrl(request.url);
  const url = new URL(request.url);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  }
  const tz = await siteTimezone(c.env, site);
  const filters = getFiltersFromSearchParams(url.searchParams);
  const { startDate, endDate } = getDateTimeRange(interval, tz);
  const analytics = c.sessionAnalytics();

  const isVisit = dimension.startsWith("visit:");
  const options = {
    orderBy: [
      {
        field: metric === "views" ? ("pageviews" as const) : metric,
        direction: "desc" as const,
      },
    ],
    pagination: { limit: PAGE_SIZE, offset: (Number(page) - 1) * PAGE_SIZE },
  };

  const rows = isVisit
    ? (
        await analytics.getSessionBreakdown(
          site,
          startDate,
          endDate,
          filters,
          dimension,
          undefined,
          options,
        )
      ).rows
    : (
        await analytics.getBasicMetrics(
          site,
          startDate,
          endDate,
          filters,
          dimension,
          undefined,
          options,
        )
      ).rows.map((row): SessionMetricsRow => ({
        ...row,
        dimension: row.dimension ?? "",
        visits: 0,
        bounces: 0,
        averageVisitDuration: null,
      }));

  const countRows = rows.map((row): CountRow =>
    metric === "events"
      ? [row.dimension, row.events]
      : [row.dimension, row.visitors, metric === "visits" ? row.visits : row.views],
  );
  return Response.json({
    countsByProperty: transform ? transform(countRows) : countRows,
    page: Number(page),
  });
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function toCountryRows(rows: CountRow[]): CountRow[] {
  return rows.map((row) => {
    const code = Array.isArray(row[0]) ? row[0][0] : row[0];
    let name = "(unknown)";
    try {
      name = regionNames.of(code) || "(unknown)";
    } catch {
      // keep "(unknown)"
    }
    return [[code, name], ...row.slice(1)] as CountRow;
  });
}

/** GET /api/dashboard/sites — registered site domains. */
export async function listSites(c: Ctx) {
  const { sites } = await new SitesRepository(c.env.DB).list({ limit: 100 });
  return Response.json({ sites: sites.map(({ domain }) => domain) });
}

/** GET /api/dashboard/stats */
export async function stats(c: Ctx, request: Request) {
  const { interval, site } = paramsFromUrl(request.url);
  const tz = searchParams(request).get("timezone") || "UTC";
  const filters = getFiltersFromSearchParams(searchParams(request));
  const { startDate, endDate } = getDateTimeRange(interval, tz);
  const analytics = c.sessionAnalytics();
  const toStatsMetrics = (m: Awaited<ReturnType<typeof analytics.getSessionMetrics>>) => ({
    views: m.views,
    visitors: m.visitors,
    visits: m.visits,
    bounceRate: m.visits > 0 ? m.bounces / m.visits : undefined,
    averageVisitDuration: m.averageVisitDuration,
    hasSufficientBounceData: true,
  });
  const span = endDate.getTime() - startDate.getTime();
  const prevStart = new Date(startDate.getTime() - span);
  const [m, prev] = await Promise.all([
    analytics.getSessionMetrics(site, startDate, endDate, filters),
    analytics.getSessionMetrics(site, prevStart, startDate, filters),
  ]);
  return Response.json({ ...toStatsMetrics(m), previous: toStatsMetrics(prev) });
}

/** GET /api/dashboard/timeseries */
export async function timeseries(c: Ctx, request: Request) {
  const { interval, site } = paramsFromUrl(request.url);
  const tz = searchParams(request).get("timezone") || "UTC";
  const filters = getFiltersFromSearchParams(searchParams(request));
  const intervalType = getIntervalType(interval);
  const { startDate, endDate } = getDateTimeRange(interval, tz);
  const dimension = intervalType === "HOUR" ? "time:hour" : "time:day";
  const { rows } = await c
    .sessionAnalytics()
    .getSessionBreakdown(site, startDate, endDate, filters, dimension, undefined, {
      orderBy: [{ field: "dimension", direction: "asc" }],
    });
  return Response.json({
    chartData: rows.map((row) => ({
      date: row.dimension,
      views: row.views,
      visitors: row.visitors,
      bounceRate: Math.floor((row.visits > 0 ? row.bounces / row.visits : 0) * 100),
    })),
    intervalType,
  });
}

/** GET /api/dashboard/goals */
export async function goals(c: Ctx, request: Request) {
  const { interval, site } = paramsFromUrl(request.url);
  const timezone = searchParams(request).get("timezone") || "UTC";
  const filters = getFiltersFromSearchParams(searchParams(request));
  const repository = new GoalsRepository(c.env.DB);
  const goalList = await repository.list(site);
  const { startDate, endDate } = getDateTimeRange(interval, timezone);
  const analytics = c.sessionAnalytics();
  const counts = await analytics.getSessionMetrics(site, startDate, endDate, filters);
  const conversions = await Promise.all(
    goalList.map(async (goal) => {
      const rows = await analytics.getBasicMetrics(
        site,
        startDate,
        endDate,
        { ...filters, name: goal.name },
        "event:name",
      );
      return rows.rows.reduce((acc, row) => acc + row.events, 0);
    }),
  );
  return Response.json({
    goals: goalList.map((goal, index) => ({
      ...goal,
      conversions: conversions[index],
      conversionRate:
        counts.visitors > 0 ? Math.min(100, (conversions[index] / counts.visitors) * 100) : 0,
    })),
  });
}

/** POST /api/dashboard/goals — create/delete a goal. */
const goalAction = z.object({
  site: z.string().min(1),
  intent: z.enum(["create", "delete"]),
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  value: z.string().optional(),
});
export async function mutateGoal(c: Ctx, request: Request) {
  const form = await request.formData();
  const parsed = goalAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return Response.json({ error: "Invalid goal action" }, { status: 400 });
  }
  const body = parsed.data;
  const repository = new GoalsRepository(c.env.DB);
  if (body.intent === "create") {
    await repository.create({
      siteId: body.site,
      name: body.name || "",
      type: (body.type || "") as GoalType,
      value: body.value || "",
    });
  } else {
    await repository.delete(body.site, body.id || "");
  }
  return Response.json({ ok: true });
}

/** GET /api/dashboard/props?event=<name>&key=<prop> */
export async function props(c: Ctx, request: Request) {
  const u = searchParams(request);
  const eventName = u.get("event") || "";
  const key = u.get("key") || "";
  if (!eventName || !/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
    return Response.json({ error: "event and key are required" }, { status: 400 });
  }
  return breakdown(c, request, `event:props:${key}` as SessionDimension, "events", undefined, {
    name: eventName,
  });
}

/** Card endpoints — one breakdown handler per dashboard card. */
export function paths(c: Ctx, r: Request) {
  return breakdown(c, r, "event:page", "views");
}
export function referrer(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:referrer", "visits");
}
export function events(c: Ctx, r: Request) {
  return breakdown(c, r, "event:name", "events", (rows) =>
    rows.filter((row) => row[0] !== "pageview" && row[0] !== "engagement"),
  );
}
export function browser(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:browser", "visits");
}
export function browserVersion(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:browser_version", "visits");
}
export function country(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:country", "visits", toCountryRows);
}
export function device(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:device_type", "visits");
}
export function utmSource(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:utm_source", "visits");
}
export function utmMedium(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:utm_medium", "visits");
}
export function utmCampaign(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:utm_campaign", "visits");
}
export function utmTerm(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:utm_term", "visits");
}
export function utmContent(c: Ctx, r: Request) {
  return breakdown(c, r, "visit:utm_content", "visits");
}

/**
 * `/api/dashboard/*` sub-router — session + admin gate first, then the
 * per-card handlers with a shared Ctx (env + analytics seam).
 */
export const dashboardApi = new Hono<{ Bindings: Env; Variables: { ctx: Ctx } }>()
  .use("/api/dashboard/*", async (c, next) => {
    const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Unauthorized" }, 401);
    if (session.user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
    c.set("ctx", {
      env: c.env,
      sessionAnalytics: sessionAnalyticsFactory(c.env, (p) => c.executionCtx.waitUntil(p)),
    });
    await next();
  })
  .get("/api/dashboard/sites", (c) => listSites(c.get("ctx")))
  .get("/api/dashboard/stats", (c) => stats(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/timeseries", (c) => timeseries(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/goals", (c) => goals(c.get("ctx"), c.req.raw))
  .post("/api/dashboard/goals", (c) => mutateGoal(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/props", (c) => props(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/paths", (c) => paths(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/referrer", (c) => referrer(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/events", (c) => events(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/browser", (c) => browser(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/browserversion", (c) => browserVersion(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/country", (c) => country(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/device", (c) => device(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/utm-source", (c) => utmSource(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/utm-medium", (c) => utmMedium(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/utm-campaign", (c) => utmCampaign(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/utm-term", (c) => utmTerm(c.get("ctx"), c.req.raw))
  .get("/api/dashboard/utm-content", (c) => utmContent(c.get("ctx"), c.req.raw));
