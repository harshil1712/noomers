import { autoTrackPageviews } from "./track";
import { instrumentEngagementLifecycle } from "./instrument";
import { clearEngagement, flushEngagement } from "./engagement";
import type { BaseClientConfig } from "../shared/types";

export type ClientOpts = BaseClientConfig & {
    autoTrackPageviews?: boolean;
};

export class Client {
    siteId: string;
    reporterUrl: string;
    reportOnLocalhost = false;

    _cleanupAutoTrackPageviews?: () => void;
    _cleanupEngagementLifecycle?: () => void;

    constructor(opts: ClientOpts) {
        this.siteId = opts.siteId;
        this.reporterUrl = opts.reporterUrl;

        if (opts.reportOnLocalhost) {
            this.reportOnLocalhost = opts.reportOnLocalhost;
        }

        this._cleanupEngagementLifecycle = instrumentEngagementLifecycle(this);

        // default to true
        if (opts.autoTrackPageviews === undefined || opts.autoTrackPageviews) {
            // Use setTimeout to ensure this runs after the constructor
            // This helps with testing and avoids issues with async trackPageview
            setTimeout(() => {
                this._cleanupAutoTrackPageviews = autoTrackPageviews(this);
            }, 0);
        }
    }

    cleanup() {
        if (this._cleanupEngagementLifecycle) {
            this._cleanupEngagementLifecycle();
            this._cleanupEngagementLifecycle = undefined;
        }
        if (this._cleanupAutoTrackPageviews) {
            this._cleanupAutoTrackPageviews();
            this._cleanupAutoTrackPageviews = undefined;
        }
        flushEngagement(this, true);
        clearEngagement(this);
    }
}
