import { vi } from "vitest";
import type { DurableEvent } from "~/analytics/collect";

export interface SiteEventsStub {
    record: ReturnType<typeof vi.fn<(event: DurableEvent) => Promise<void>>>;
    realtime: ReturnType<typeof vi.fn>;
    purge: ReturnType<typeof vi.fn>;
}

export function createSiteEventsStub(): {
    stub: SiteEventsStub;
    // Typed as a real namespace so test envs can pass it as SITE_EVENTS.
    namespace: DurableObjectNamespace<import("../../workers/site-events").SiteEvents>;
} {
    const stub: SiteEventsStub = {
        record: vi.fn((..._args: any[]) => Promise.resolve()),
        realtime: vi.fn(() =>
            Promise.resolve({
                currentVisitors: 0,
                visitors30m: 0,
                pageviews30m: 0,
                pageviewsPerMinute: new Array(30).fill(0),
                topPages: [],
                topReferrers: [],
                topCountries: [],
            }),
        ),
        purge: vi.fn(() => Promise.resolve()),
    };
    const namespace = {
        idFromName: (name: string) => name,
        get: () => stub,
    } as unknown as DurableObjectNamespace<
        import("../../workers/site-events").SiteEvents
    >;
    return { stub, namespace };
}
