import { Hono } from "hono";
import type { Context } from "hono";
import { requireAPIKey } from "../api/auth";
import {
  SitesRepository,
  validatePlausibleScriptId,
  siteResponse,
  type TrackerScriptConfiguration,
} from "../sites/repository";
import { validateTeamId, SINGLE_ORGANIZATION } from "../sites/team";
import { GoalsRepository, type Goal, type GoalType } from "../goals/repository";
import { CustomPropertiesRepository } from "../custom-properties/repository";

type C = Context<{ Bindings: Env }>;

const sites = new Hono<{ Bindings: Env }>();

function notImplemented() {
  return Response.json({ error: "Not Implemented" }, { status: 501 });
}

function methodNotAllowed() {
  return Response.json({ error: "Method Not Allowed" }, { status: 405 });
}

function notFound() {
  return Response.json({ error: "Site not found" }, { status: 404 });
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

async function requireSite(database: D1Database, siteId: string) {
  return siteId ? new SitesRepository(database).get(siteId) : null;
}

// ---------------------------------------------------------------------------
// /api/v1/sites
// ---------------------------------------------------------------------------

export async function listSites(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  try {
    const url = new URL(c.req.url);
    validateTeamId(url.searchParams.get("team_id"));
    const result = await new SitesRepository(c.env.DB).list({
      after: url.searchParams.get("after") || undefined,
      before: url.searchParams.get("before") || undefined,
      limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
    });
    return Response.json({
      sites: result.sites.map(({ domain, timezone }) => ({ domain, timezone })),
      meta: {
        after: result.after,
        before: result.before,
        limit: result.limit,
      },
    });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

export async function createSite(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  try {
    const input = (await c.req.raw.json()) as {
      domain?: string;
      timezone?: string;
      tracker_script_configuration?: Partial<TrackerScriptConfiguration>;
      plausible_script_id?: string | null;
      team_id?: string;
    };
    validateTeamId(input.team_id);
    const plausibleScriptId = validatePlausibleScriptId(input.plausible_script_id);
    const site = await new SitesRepository(c.env.DB).create({
      domain: input.domain || "",
      timezone: input.timezone,
      trackerScriptConfiguration: input.tracker_script_configuration,
      plausibleScriptId,
    });
    return Response.json(siteResponse(site));
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

export async function getSite(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  const site = await new SitesRepository(c.env.DB).get(c.req.param("site_id") || "");
  return site ? Response.json(siteResponse(site)) : notFound();
}

export async function mutateSite(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  const request = c.req.raw;
  const repository = new SitesRepository(c.env.DB);
  if (request.method === "DELETE") {
    const siteId = c.req.param("site_id") || "";
    const deleted = await repository.delete(siteId);
    if (!deleted) return notFound();
    const namespace = c.env.SITE_EVENTS;
    if (namespace) {
      try {
        await namespace.get(namespace.idFromName(siteId)).purge();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "site events purge failed",
            error: String(error),
          }),
        );
        return Response.json(
          {
            deleted: "true",
            warning: "site tombstoned, but realtime-buffered data purge failed",
          },
          { status: 502 },
        );
      }
    }
    return Response.json({ deleted: "true" });
  }
  if (request.method !== "PUT") {
    return methodNotAllowed();
  }
  try {
    const input = (await request.json()) as {
      domain?: string;
      timezone?: string;
      tracker_script_configuration?: Partial<TrackerScriptConfiguration>;
      plausible_script_id?: string | null;
    };
    const site = await repository.update(c.req.param("site_id") || "", {
      domain: input.domain,
      timezone: input.timezone,
      trackerScriptConfiguration: input.tracker_script_configuration,
      plausibleScriptId: validatePlausibleScriptId(input.plausible_script_id),
    });
    return site ? Response.json(siteResponse(site)) : notFound();
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

// ---------------------------------------------------------------------------
// /api/v1/sites/goals
// ---------------------------------------------------------------------------

function goalResponse(goal: Goal) {
  const isEvent = goal.type === "event";
  return {
    id: goal.id,
    goal_type: isEvent ? "event" : "page",
    display_name: goal.name,
    event_name: isEvent ? goal.value : null,
    page_path: isEvent ? null : goal.value,
    custom_props: goal.customProps,
  };
}

export async function listGoals(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  const url = new URL(c.req.url);
  const siteId = url.searchParams.get("site_id") || "";
  const site = await requireSite(c.env.DB, siteId);
  if (!site) {
    return notFound();
  }
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "limit must be between 1 and 100." }, { status: 400 });
  }
  const goals = await new GoalsRepository(c.env.DB).list(site.domain);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  if (after && before) {
    return Response.json({ error: "Use either after or before, not both." }, { status: 400 });
  }
  let start = after ? goals.findIndex((goal) => goal.id === after) + 1 : 0;
  if (before) {
    const index = goals.findIndex((goal) => goal.id === before);
    start = Math.max(0, (index < 0 ? goals.length : index) - limit);
  }
  const page = goals.slice(start, start + limit);
  return Response.json({
    goals: page.map(goalResponse),
    meta: {
      after: start + page.length < goals.length ? page.at(-1)?.id || null : null,
      before: start > 0 ? page[0]?.id || null : null,
      limit,
    },
  });
}

export async function createGoal(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  try {
    const input = (await c.req.raw.json()) as {
      site_id?: string;
      goal_type?: "event" | "page";
      event_name?: string;
      page_path?: string;
      display_name?: string;
      custom_props?: Record<string, string>;
    };
    const siteId = input.site_id || "";
    const site = await requireSite(c.env.DB, siteId);
    if (!site) {
      return notFound();
    }
    const canonicalSiteId = site.domain;
    const type: GoalType = input.goal_type === "page" ? "pageview" : "event";
    if (input.goal_type !== "event" && input.goal_type !== "page") {
      throw new Error("goal_type must be event or page.");
    }
    const value = type === "event" ? input.event_name : input.page_path;
    if (!value)
      throw new Error(type === "event" ? "event_name is required." : "page_path is required.");
    const repository = new GoalsRepository(c.env.DB);
    const customProps = input.custom_props || {};
    const existing = (await repository.list(canonicalSiteId)).find(
      (goal) =>
        goal.type === type &&
        goal.value === value.trim() &&
        JSON.stringify(goal.customProps) ===
          JSON.stringify(
            Object.fromEntries(Object.entries(customProps).sort(([a], [b]) => a.localeCompare(b))),
          ),
    );
    const goal =
      existing ||
      (await repository.create({
        siteId: canonicalSiteId,
        type,
        value,
        name:
          input.display_name?.trim() || (type === "event" ? value.trim() : `Visit ${value.trim()}`),
        customProps,
      }));
    return Response.json({ domain: canonicalSiteId, ...goalResponse(goal) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

export async function deleteGoal(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  try {
    const input = (await c.req.raw.json()) as { site_id?: string };
    const siteId = input.site_id || "";
    const site = siteId ? await new SitesRepository(c.env.DB).get(siteId) : null;
    if (!site) {
      return notFound();
    }
    const deleted = await new GoalsRepository(c.env.DB).delete(
      site.domain,
      c.req.param("goal_id") || "",
    );
    return deleted
      ? Response.json({ deleted: "true" })
      : Response.json({ error: "Goal not found" }, { status: 404 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

// ---------------------------------------------------------------------------
// /api/v1/sites/custom-props
// ---------------------------------------------------------------------------

async function siteFromInput(database: D1Database, siteId: string | File | null) {
  if (siteId === null || siteId instanceof File || !siteId) return null;
  return new SitesRepository(database).get(siteId);
}

export async function listCustomProps(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  const site = await siteFromInput(c.env.DB, new URL(c.req.url).searchParams.get("site_id"));
  if (!site) return notFound();

  const properties = await new CustomPropertiesRepository(c.env.DB).list(site.domain);
  return Response.json({
    custom_properties: properties.map((property) => ({ property })),
  });
}

export async function createCustomProp(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const input = await c.req.raw.formData();
    const site = await siteFromInput(c.env.DB, input.get("site_id"));
    if (!site) return notFound();
    const property = input.get("property");
    if (property === null || property instanceof File) throw new Error("property is required.");
    const created = await new CustomPropertiesRepository(c.env.DB).create(site.domain, property);
    return Response.json({ created });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

export async function deleteCustomProp(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const input = await c.req.raw.formData();
    const site = await siteFromInput(c.env.DB, input.get("site_id"));
    if (!site) return notFound();
    const deleted = await new CustomPropertiesRepository(c.env.DB).delete(
      site.domain,
      c.req.param("property") || "",
    );
    return Response.json({ deleted });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request");
  }
}

// ---------------------------------------------------------------------------
// Deferred / unsupported resources
// ---------------------------------------------------------------------------

export async function listTeams(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  return Response.json({
    teams: [SINGLE_ORGANIZATION],
    meta: { after: null, before: null, limit: 100 },
  });
}

/** guests / shared-links: authenticated 501 (or 405 for other methods). */
export async function deferredResource(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  const method = c.req.method;
  if (method === "GET" || method === "PUT" || method === "DELETE") {
    return notImplemented();
  }
  return methodNotAllowed();
}

/** guests/:email — action-only resource: 501 on DELETE, 405 otherwise. */
export async function deferredGuest(c: C) {
  const unauthorized = await requireAPIKey(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  if (c.req.method === "DELETE") {
    return notImplemented();
  }
  return methodNotAllowed();
}

// ---------------------------------------------------------------------------
// Router — method ordering mirrors the old loader(GET)/action(other) split:
// collection actions reject non-matching methods with 405 before auth, the
// same as the React Router action guards did.
// ---------------------------------------------------------------------------

sites.get("/api/v1/sites", listSites);
sites.post("/api/v1/sites", createSite);
sites.all("/api/v1/sites", () => methodNotAllowed());

sites.get("/api/v1/sites/teams", listTeams);
sites.all("/api/v1/sites/teams", () => methodNotAllowed());

sites.on(["GET", "PUT", "DELETE"], "/api/v1/sites/guests", deferredResource);
sites.all("/api/v1/sites/guests", deferredResource);
sites.on(["GET", "PUT", "DELETE"], "/api/v1/sites/shared-links", deferredResource);
sites.all("/api/v1/sites/shared-links", deferredResource);
sites.all("/api/v1/sites/guests/:email", deferredGuest);

sites.get("/api/v1/sites/goals", listGoals);
sites.put("/api/v1/sites/goals", createGoal);
sites.all("/api/v1/sites/goals", () => methodNotAllowed());
sites.delete("/api/v1/sites/goals/:goal_id", deleteGoal);
sites.all("/api/v1/sites/goals/:goal_id", () => methodNotAllowed());

sites.get("/api/v1/sites/custom-props", listCustomProps);
sites.put("/api/v1/sites/custom-props", createCustomProp);
sites.all("/api/v1/sites/custom-props", () => methodNotAllowed());
sites.delete("/api/v1/sites/custom-props/:property", deleteCustomProp);
sites.all("/api/v1/sites/custom-props/:property", () => methodNotAllowed());

sites.get("/api/v1/sites/:site_id", getSite);
sites.on(["PUT", "DELETE"], "/api/v1/sites/:site_id", mutateSite);
sites.all("/api/v1/sites/:site_id", mutateSite);

export const sitesApi = sites;
