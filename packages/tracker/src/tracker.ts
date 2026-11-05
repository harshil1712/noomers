"use strict";

import * as noomers from "./index";

function findReporterScript() {
    const el = document.getElementById(
        "noomers-script",
    ) as HTMLScriptElement;
    return el;
}

function init() {
    const script = findReporterScript();
    const siteId = script?.getAttribute("data-site-id");
    const reportOnLocalhost = (script?.hasAttribute("data-report-localhost") && script?.getAttribute("data-report-localhost") !== "false") || false;

    const reporterUrl = script?.src.replace("tracker.js", "collect");

    if (!siteId || !reporterUrl) {
        return;
    }

    noomers.init({
        siteId,
        reportOnLocalhost,
        reporterUrl,
        autoTrackPageviews: true,
    });
}

(function () {
    // body (and thus, script elem) might not be accessible until
    // DOMContentLoaded, so wait for that first
    if (document.body === null) {
        document.addEventListener("DOMContentLoaded", () => {
            init();
        });
        return;
    }

    init();
})();
