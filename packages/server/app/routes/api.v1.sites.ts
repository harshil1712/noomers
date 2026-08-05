import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import {
    SitesRepository,
    siteResponse,
    type TrackerScriptConfiguration,
} from "~/sites/repository";
import { validateTeamId } from "~/sites/team";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    try {
        const url = new URL(request.url);
        validateTeamId(url.searchParams.get("team_id"));
        const result = await new SitesRepository(
            context.cloudflare.env.GOALS_DB,
        ).list({
            after: url.searchParams.get("after") || undefined,
            before: url.searchParams.get("before") || undefined,
            limit: url.searchParams.has("limit")
                ? Number(url.searchParams.get("limit"))
                : undefined,
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
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}

export async function action({ request, context }: ActionFunctionArgs) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    try {
        const input = (await request.json()) as {
            domain?: string;
            timezone?: string;
            tracker_script_configuration?: Partial<TrackerScriptConfiguration>;
            team_id?: string;
        };
        validateTeamId(input.team_id);
        const site = await new SitesRepository(
            context.cloudflare.env.GOALS_DB,
        ).create({
            domain: input.domain || "",
            timezone: input.timezone,
            trackerScriptConfiguration: input.tracker_script_configuration,
        });
        return Response.json(siteResponse(site));
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}
