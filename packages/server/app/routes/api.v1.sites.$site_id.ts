import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import {
    SitesRepository,
    siteResponse,
    type TrackerScriptConfiguration,
} from "~/sites/repository";

function notFound() {
    return Response.json({ error: "Site not found" }, { status: 404 });
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    const site = await new SitesRepository(context.cloudflare.env.GOALS_DB).get(
        params.site_id || "",
    );
    return site ? Response.json(siteResponse(site)) : notFound();
}

export async function action({ request, context, params }: ActionFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    const repository = new SitesRepository(context.cloudflare.env.GOALS_DB);
    if (request.method === "DELETE") {
        return (await repository.delete(params.site_id || ""))
            ? Response.json({ deleted: "true" })
            : notFound();
    }
    if (request.method !== "PUT") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    try {
        const input = (await request.json()) as {
            domain?: string;
            timezone?: string;
            tracker_script_configuration?: Partial<TrackerScriptConfiguration>;
        };
        const site = await repository.update(params.site_id || "", {
            domain: input.domain,
            timezone: input.timezone,
            trackerScriptConfiguration: input.tracker_script_configuration,
        });
        return site ? Response.json(siteResponse(site)) : notFound();
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}
