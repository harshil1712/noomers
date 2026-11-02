import { describe, test, expect, vi } from "vitest";
import { loader } from "../resources.stats";

vi.mock("~/lib/auth", () => ({
    requireAuth: vi.fn(),
}));

function context(sessionMetrics: unknown) {
    return {
        sessionAnalytics: () => ({
            getSessionMetrics: vi.fn().mockResolvedValue(sessionMetrics),
        }),
        cloudflare: {
            env: {
                CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                CF_JWT_SECRET: "test-secret",
            },
        },
    };
}

describe("resources.stats loader", () => {
    test("returns formatted stats from session metrics", async () => {
        const sessionMetrics = {
            views: 1000,
            visitors: 250,
            visits: 300,
            bounces: 120,
            events: 1100,
            averageVisitDuration: 42,
        };
        const request = new Request(
            "https://example.com/resources/stats?site=test-site&interval=24h&timezone=UTC",
        );
        const data = await loader({
            context: context(sessionMetrics),
            request,
        } as any);

        expect(data).toEqual({
            views: 1000,
            visitors: 250,
            visits: 300,
            bounceRate: 0.4,
            averageVisitDuration: 42,
            hasSufficientBounceData: true,
        });
    });

    test("bounce rate is undefined when there are no visits", async () => {
        const sessionMetrics = {
            views: 0,
            visitors: 0,
            visits: 0,
            bounces: 0,
            events: 0,
            averageVisitDuration: null,
        };
        const request = new Request(
            "https://example.com/resources/stats?site=test-site&interval=24h&timezone=UTC",
        );
        const data = await loader({
            context: context(sessionMetrics),
            request,
        } as any);

        expect(data.bounceRate).toBeUndefined();
    });
});
