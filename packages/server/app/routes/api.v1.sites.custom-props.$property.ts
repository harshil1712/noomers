import type { ActionFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import { CustomPropertiesRepository } from "~/custom-properties/repository";
import { SitesRepository } from "~/sites/repository";

export async function action({ request, context, params }: ActionFunctionArgs) {
    if (request.method !== "DELETE") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;

    try {
        const input = await request.formData();
        const siteId = input.get("site_id");
        const site =
            typeof siteId === "string" && siteId
                ? await new SitesRepository(context.cloudflare.env.GOALS_DB).get(siteId)
                : null;
        if (!site) return Response.json({ error: "Site not found" }, { status: 404 });
        const deleted = await new CustomPropertiesRepository(
            context.cloudflare.env.GOALS_DB,
        ).delete(site.domain, params.property || "");
        return Response.json({ deleted });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}
