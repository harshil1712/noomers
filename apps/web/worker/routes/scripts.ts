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
  const isCustomScript = customScriptName && requestedBaseName === customScriptName;

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
