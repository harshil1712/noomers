import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import { CustomPropertiesRepository } from "~/custom-properties/repository";
import { SitesRepository } from "~/sites/repository";

async function getSite(database: D1Database, siteId: FormDataEntryValue | string | null) {
    return typeof siteId === "string" && siteId
        ? new SitesRepository(database).get(siteId)
        : null;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
    const unauthorized = await requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;

    const site = await getSite(
        context.cloudflare.env.DB,
        new URL(request.url).searchParams.get("site_id"),
    );
    if (!site) return Response.json({ error: "Site not found" }, { status: 404 });

    const properties = await new CustomPropertiesRepository(
        context.cloudflare.env.DB,
    ).list(site.domain);
    return Response.json({
        custom_properties: properties.map((property) => ({ property })),
    });
}

export async function action({ request, context }: ActionFunctionArgs) {
    if (request.method !== "PUT") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    const unauthorized = await requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;

    try {
        const input = await request.formData();
        const site = await getSite(context.cloudflare.env.DB, input.get("site_id"));
        if (!site) return Response.json({ error: "Site not found" }, { status: 404 });
        const property = input.get("property");
        if (typeof property !== "string") throw new Error("property is required.");
        const created = await new CustomPropertiesRepository(
            context.cloudflare.env.DB,
        ).create(site.domain, property);
        return Response.json({ created });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400 },
        );
    }
}
