import type { ActionFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import { GoalsRepository } from "~/goals/repository";
import { SitesRepository } from "~/sites/repository";

export async function action({ request, context, params }: ActionFunctionArgs) {
    if (request.method !== "DELETE") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    const unauthorized = await requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    try {
        const input = (await request.json()) as { site_id?: string };
        const siteId = input.site_id || "";
        const site = siteId
            ? await new SitesRepository(context.cloudflare.env.DB).get(siteId)
            : null;
        if (!site) {
            return Response.json({ error: "Site not found" }, { status: 404 });
        }
        const deleted = await new GoalsRepository(context.cloudflare.env.DB).delete(
            site.domain,
            params.goal_id || "",
        );
        return deleted
            ? Response.json({ deleted: "true" })
            : Response.json({ error: "Goal not found" }, { status: 404 });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}
