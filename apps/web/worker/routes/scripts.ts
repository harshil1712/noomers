import { PLAUSIBLE_TRACKER_TEMPLATE } from "../analytics/plausible-tracker-template";
import { SitesRepository } from "../sites/repository";

const SCRIPT_ID_PATTERN = /^(pa-[A-Za-z0-9_-]{8,64})\.js$/;

/**
 * GET /<script>.js — serves the built tracker from assets under the default
 * name ("tracker.js") or the deployment's CF_TRACKER_SCRIPT_NAME.
 */
export async function handleTrackerScript(
    request: Request,
    env: Env,
    requestedScript: string | undefined,
) {
    if (!requestedScript || !requestedScript.endsWith(".js")) {
        return new Response("Not Found", { status: 404 });
    }

    const customScriptName = env.CF_TRACKER_SCRIPT_NAME;
    const defaultScriptName = "tracker";

    const requestedBaseName = requestedScript.replace(".js", "");

    const isDefaultScript = requestedBaseName === defaultScriptName;
    const isCustomScript =
        customScriptName && requestedBaseName === customScriptName;

    if (!isDefaultScript && !isCustomScript) {
        return new Response("Script not found", { status: 404 });
    }

    try {
        const url = new URL(request.url);
        const trackerUrl = `${url.protocol}//${url.host}/tracker.js`;
        return await env.ASSETS.fetch(trackerUrl);
    } catch (error) {
        console.error("Error serving tracker script:", error);
        return new Response("Error serving script", { status: 500 });
    }
}

/** GET /js/<pa-script-id>.js — per-site Plausible-compat tracker snippet. */
export async function handlePlausibleScript(
    request: Request,
    env: Env,
    script: string | undefined,
) {
    const match = SCRIPT_ID_PATTERN.exec(script || "");
    if (!match) return new Response("Not Found", { status: 404 });
    const scriptId = match[1];

    const site = await new SitesRepository(env.DB).getByPlausibleScriptId(
        scriptId,
    );
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
