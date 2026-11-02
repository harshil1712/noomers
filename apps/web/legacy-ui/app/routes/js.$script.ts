import type { LoaderFunctionArgs } from "react-router";
import { PLAUSIBLE_TRACKER_TEMPLATE } from "~/analytics/plausible-tracker-template";
import { SitesRepository } from "~/sites/repository";

const SCRIPT_ID_PATTERN = /^(pa-[A-Za-z0-9_-]{8,64})\.js$/;

export async function loader({ params, request, context }: LoaderFunctionArgs) {
    const match = SCRIPT_ID_PATTERN.exec(params.script || "");
    if (!match) return new Response("Not Found", { status: 404 });
    const scriptId = match[1];

    const site = await new SitesRepository(
        context.cloudflare.env.DB,
    ).getByPlausibleScriptId(scriptId);
    if (!site) return new Response("Not Found", { status: 404 });

    const origin = new URL(request.url).origin;
    const body = PLAUSIBLE_TRACKER_TEMPLATE.replaceAll(
        "__DOMAIN__",
        site.domain.replace(/["\\]/g, ""),
    ).replaceAll("__ENDPOINT__", `${origin}/api/event`);

    return new Response(body, {
        headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
