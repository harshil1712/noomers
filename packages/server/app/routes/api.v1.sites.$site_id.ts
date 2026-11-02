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
    const unauthorized = await requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    const site = await new SitesRepository(context.cloudflare.env.GOALS_DB).get(
        params.site_id || "",
    );
    return site ? Response.json(siteResponse(site)) : notFound();
}

export async function action({ request, context, params }: ActionFunctionArgs) {
    const unauthorized = await requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    const repository = new SitesRepository(context.cloudflare.env.GOALS_DB);
    if (request.method === "DELETE") {
        const siteId = params.site_id || "";
        const deleted = await repository.delete(siteId);
        if (!deleted) return notFound();
        const namespace = context.cloudflare.env.SITE_EVENTS;
        if (namespace) {
            context.cloudflare.ctx.waitUntil(
                namespace
                    .get(namespace.idFromName(siteId))
                    .purge()
                    .catch((error: unknown) =>
                        console.error(
                            JSON.stringify({
                                message: "site events purge failed",
                                error: String(error),
                            }),
                        ),
                    ),
            );
        }
        return Response.json({ deleted: "true" });
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
