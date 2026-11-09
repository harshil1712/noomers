export function resolveTrackerConfig(script: HTMLScriptElement | null) {
    const siteId = script?.getAttribute("data-site-id");
    const reportOnLocalhost =
        (script?.hasAttribute("data-report-localhost") &&
            script?.getAttribute("data-report-localhost") !== "false") ||
        false;
    const reporterUrl = script ? new URL("/collect", script.src).href : undefined;
    if (!siteId || !reporterUrl) return null;
    return { siteId, reportOnLocalhost, reporterUrl };
}
