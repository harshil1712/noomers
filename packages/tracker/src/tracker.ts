"use strict";

import * as noomers from "./index";
import { resolveTrackerConfig } from "./tracker-config";

// Only set while a classic/defer script executes synchronously — capture at
// module top level, before the DOMContentLoaded wait.
const currentScript = document.currentScript as HTMLScriptElement | null;

function findReporterScript() {
    const el =
        currentScript ?? document.querySelector("script[data-site-id]");
    return el as HTMLScriptElement | null;
}

function init() {
    const config = resolveTrackerConfig(findReporterScript());
    if (!config) {
        return;
    }
    const { siteId, reportOnLocalhost, reporterUrl } = config;

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
