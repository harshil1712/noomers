import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import { GoalsRepository, type Goal, type GoalType } from "~/goals/repository";
import { SitesRepository } from "~/sites/repository";

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

async function requireSite(database: D1Database, siteId: string) {
    return siteId ? new SitesRepository(database).get(siteId) : null;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    const url = new URL(request.url);
    const siteId = url.searchParams.get("site_id") || "";
    const site = await requireSite(context.cloudflare.env.GOALS_DB, siteId);
    if (!site) {
        return Response.json({ error: "Site not found" }, { status: 404 });
    }
    const limit = url.searchParams.has("limit")
        ? Number(url.searchParams.get("limit"))
        : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return Response.json({ error: "limit must be between 1 and 100." }, { status: 400 });
    }
    const goals = await new GoalsRepository(context.cloudflare.env.GOALS_DB).list(site.domain);
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

export async function action({ request, context }: ActionFunctionArgs) {
    if (request.method !== "PUT") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    try {
        const input = (await request.json()) as {
            site_id?: string;
            goal_type?: "event" | "page";
            event_name?: string;
            page_path?: string;
            display_name?: string;
            custom_props?: Record<string, string>;
        };
        const siteId = input.site_id || "";
        const site = await requireSite(context.cloudflare.env.GOALS_DB, siteId);
        if (!site) {
            return Response.json({ error: "Site not found" }, { status: 404 });
        }
        const canonicalSiteId = site.domain;
        const type: GoalType = input.goal_type === "page" ? "pageview" : "event";
        if (input.goal_type !== "event" && input.goal_type !== "page") {
            throw new Error("goal_type must be event or page.");
        }
        const value = type === "event" ? input.event_name : input.page_path;
        if (!value) throw new Error(type === "event" ? "event_name is required." : "page_path is required.");
        const repository = new GoalsRepository(context.cloudflare.env.GOALS_DB);
        const customProps = input.custom_props || {};
        const existing = (await repository.list(canonicalSiteId)).find(
            (goal) =>
                goal.type === type &&
                goal.value === value.trim() &&
                JSON.stringify(goal.customProps) ===
                    JSON.stringify(Object.fromEntries(Object.entries(customProps).sort())),
        );
        const goal = existing || await repository.create({
            siteId: canonicalSiteId,
            type,
            value,
            name: input.display_name?.trim() || (type === "event" ? value.trim() : `Visit ${value.trim()}`),
            customProps,
        });
        return Response.json({ domain: canonicalSiteId, ...goalResponse(goal) });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}
