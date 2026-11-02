import { vi } from "vitest";
import { R2SQLAPI } from "../../analytics/r2-sql";

export function createFetchResponse<T>(data: T) {
    return {
        ok: true,
        json: () => new Promise<T>((resolve) => resolve(data)),
    };
}

const mockAnalytics = new Proxy(
    {},
    {
        get: (_target, prop) => {
            if (!(prop in _target)) {
                (_target as Record<string | symbol, unknown>)[prop] = vi.fn(
                    async () => ({ rows: [] }),
                );
            }
            return (_target as Record<string | symbol, unknown>)[prop];
        },
    },
) as unknown as R2SQLAPI;

export function getDefaultContext() {
    return {
        context: {
            sessionAnalytics: () => mockAnalytics,
            basinConfigured: true,
            cloudflare: {
                env: {
                    CF_ACCOUNT_ID: "fake",
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                    GOALS_DB: {},
                },
                // eslint-disable-next-line
                cf: {} as any,
            },
        },
    };
}
