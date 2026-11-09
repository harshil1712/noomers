import type { Client } from "./client";
import { flushPendingPageview } from "./track";
import {
    onEngagementHidden,
    onEngagementPagehide,
    onEngagementPageshowPersisted,
    onEngagementVisible,
} from "./engagement";

export function instrumentHistoryBuiltIns(callback: () => void) {
    const origPushState = history.pushState;

    // NOTE: Intentionally only declaring 2 parameters for this pushState wrapper,
    //       because that is the arity of the built-in function we're overwriting.

    // See: https://blog.sentry.io/wrap-javascript-functions/#preserve-arity

    // eslint-disable-next-line
    history.pushState = function (data, title /*, url */) {
        // eslint-disable-next-line
        origPushState.apply(this, arguments as any);
        callback();
    };

    const listener = () => {
        callback();
    };
    addEventListener("popstate", listener);

    return () => {
        history.pushState = origPushState;
        removeEventListener("popstate", listener);
    };
}

export function instrumentEngagementLifecycle(client: Client): () => void {
    const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
            flushPendingPageview();
            onEngagementHidden(client);
        } else {
            onEngagementVisible(client);
        }
    };

    const onPagehide = () => {
        flushPendingPageview();
        onEngagementPagehide(client);
    };

    const onPageshow = (event: PageTransitionEvent) => {
        if (event.persisted) {
            onEngagementPageshowPersisted(client);
        }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPagehide);
    window.addEventListener("pageshow", onPageshow);

    return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPagehide);
        window.removeEventListener("pageshow", onPageshow);
    };
}
