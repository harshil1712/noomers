import { describe, it, expect, vi } from "vitest";
import {
    provisionSiteIdempotently,
    discoverHistoricalSites,
    applyBackfill,
    resolveNoomersApiToken,
    presentBackfill,
    provisionInitialSite,
} from "../provision.js";
import type { CloudflareClient } from "../cloudflare.js";
import { BACKFILL_LIMIT } from "../backfill.js";

function makeClient(
    overrides: Partial<CloudflareClient> = {},
): CloudflareClient {
    return {
        getSiteByDomain: vi.fn(),
        createSite: vi.fn(),
        queryAnalyticsEngine: vi.fn(),
        executeD1Statement: vi.fn(),
        ...overrides,
    } as unknown as CloudflareClient;
}

describe("provisionSiteIdempotently", () => {
    it("creates a site only when it is missing", async () => {
        const client = makeClient({
            getSiteByDomain: vi.fn().mockResolvedValue(null),
            createSite: vi.fn().mockResolvedValue({ domain: "example.com" }),
        });

        const result = await provisionSiteIdempotently(
            client,
            "https://app.example.workers.dev",
            "token",
            "example.com",
            "Etc/UTC",
        );

        expect(client.getSiteByDomain).toHaveBeenCalledWith(
            "https://app.example.workers.dev",
            "token",
            "example.com",
        );
        expect(client.createSite).toHaveBeenCalledWith(
            "https://app.example.workers.dev",
            "token",
            "example.com",
            "Etc/UTC",
        );
        expect(result.created).toBe(true);
    });

    it("does not POST when the site already exists", async () => {
        const client = makeClient({
            getSiteByDomain: vi
                .fn()
                .mockResolvedValue({ domain: "example.com" }),
            createSite: vi.fn(),
        });

        const result = await provisionSiteIdempotently(
            client,
            "https://app.example.workers.dev",
            "token",
            "example.com",
            "Etc/UTC",
        );

        expect(client.createSite).not.toHaveBeenCalled();
        expect(result.created).toBe(false);
    });

    it("retries transient 5xx/network failures with injectable sleep and stays idempotent", async () => {
        const client = makeClient({
            getSiteByDomain: vi
                .fn()
                .mockResolvedValueOnce(null) // attempt 1: no site yet
                .mockResolvedValueOnce(null), // attempt 2: still none
            createSite: vi
                .fn()
                .mockRejectedValueOnce(
                    new Error(
                        "Sites API POST failed (HTTP 500): Internal Server Error",
                    ),
                )
                .mockResolvedValueOnce({ domain: "example.com" }),
        });
        const sleeps: number[] = [];
        const sleep = vi.fn().mockImplementation(async (ms: number) => {
            sleeps.push(ms);
        });

        const result = await provisionSiteIdempotently(
            client,
            "https://app.example.workers.dev",
            "token",
            "example.com",
            "Etc/UTC",
            { maxRetries: 3, sleep },
        );

        expect(result.created).toBe(true);
        expect(client.createSite).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleeps[0]).toBeGreaterThan(0);
    });

    it("does not retry deterministic 4xx/auth failures", async () => {
        const client = makeClient({
            getSiteByDomain: vi
                .fn()
                .mockRejectedValue(
                    new Error("Sites API GET failed (HTTP 401): Unauthorized"),
                ),
            createSite: vi.fn(),
        });
        const sleep = vi.fn();

        await expect(
            provisionSiteIdempotently(
                client,
                "https://app.example.workers.dev",
                "token",
                "example.com",
                "Etc/UTC",
                { maxRetries: 3, sleep },
            ),
        ).rejects.toThrow(/HTTP 401/);

        expect(client.createSite).not.toHaveBeenCalled();
        expect(sleep).not.toHaveBeenCalled();
    });

    it("fails clearly after exhausting retries and states rerun is safe", async () => {
        const client = makeClient({
            getSiteByDomain: vi.fn().mockResolvedValue(null),
            createSite: vi
                .fn()
                .mockRejectedValue(
                    new Error(
                        "Sites API POST failed (HTTP 503): Service Unavailable",
                    ),
                ),
        });
        const sleep = vi.fn();

        await expect(
            provisionSiteIdempotently(
                client,
                "https://app.example.workers.dev",
                "token",
                "example.com",
                "Etc/UTC",
                { maxRetries: 3, sleep },
            ),
        ).rejects.toThrow(
            /deploy succeeded; rerunning noomers install is safe/,
        );

        expect(client.createSite).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("exposes an injectable retry classifier", async () => {
        const client = makeClient({
            getSiteByDomain: vi.fn().mockResolvedValue(null),
            createSite: vi
                .fn()
                .mockRejectedValueOnce(new Error("weird transient"))
                .mockResolvedValueOnce({ domain: "example.com" }),
        });
        const isRetryable = vi.fn().mockReturnValue(true);
        const sleep = vi.fn();

        const result = await provisionSiteIdempotently(
            client,
            "https://app.example.workers.dev",
            "token",
            "example.com",
            "Etc/UTC",
            { maxRetries: 2, sleep, isRetryable },
        );

        expect(result.created).toBe(true);
        expect(isRetryable).toHaveBeenCalled();
    });
});

describe("discoverHistoricalSites", () => {
    it("queries, bounds, validates, dedupes, and sorts site IDs and includes timezone", async () => {
        const client = makeClient({
            queryAnalyticsEngine: vi.fn().mockResolvedValue({
                data: [
                    { siteId: "zebra.com" },
                    { siteId: "EXAMPLE.com" },
                    { siteId: "example.com" },
                    { siteId: "alpha.com" },
                ],
                rows: 4,
            }),
        });

        const plan = await discoverHistoricalSites(
            client,
            "acct",
            "token",
            "metricsDataset",
            "America/New_York",
        );

        expect(client.queryAnalyticsEngine).toHaveBeenCalledTimes(1);
        expect(plan.dataset).toBe("metricsDataset");
        expect(plan.timezone).toBe("America/New_York");
        expect(plan.domains).toEqual(["alpha.com", "example.com", "zebra.com"]);
    });

    it("ignores empty/null site IDs", async () => {
        const client = makeClient({
            queryAnalyticsEngine: vi.fn().mockResolvedValue({
                data: [
                    { siteId: "example.com" },
                    { siteId: null },
                    { siteId: "" },
                ],
            }),
        });

        const plan = await discoverHistoricalSites(
            client,
            "acct",
            "token",
            "metricsDataset",
            "Etc/UTC",
        );

        expect(plan.domains).toEqual(["example.com"]);
    });

    it("throws on malformed nonempty site IDs instead of dropping them", async () => {
        const client = makeClient({
            queryAnalyticsEngine: vi.fn().mockResolvedValue({
                data: [{ siteId: "example.com" }, { siteId: "bad domain" }],
            }),
        });

        await expect(
            discoverHistoricalSites(
                client,
                "acct",
                "token",
                "metricsDataset",
                "Etc/UTC",
            ),
        ).rejects.toThrow(/Invalid historical site ID/);
    });

    it("throws when the result is truncated", async () => {
        const client = makeClient({
            queryAnalyticsEngine: vi.fn().mockResolvedValue({
                data: Array.from({ length: BACKFILL_LIMIT + 1 }, () => ({
                    siteId: "x.com",
                })),
            }),
        });

        await expect(
            discoverHistoricalSites(
                client,
                "acct",
                "token",
                "metricsDataset",
                "Etc/UTC",
            ),
        ).rejects.toThrow(/More than 1000/);
    });

    it("fails closed when the 200 response body carries errors", async () => {
        const client = makeClient({
            queryAnalyticsEngine: vi.fn().mockResolvedValue({
                data: [{ siteId: "example.com" }],
                errors: [{ code: 40004, message: "Invalid query" }],
            }),
        });

        await expect(
            discoverHistoricalSites(
                client,
                "acct",
                "token",
                "metricsDataset",
                "Etc/UTC",
            ),
        ).rejects.toThrow(/errors in the response body/);
    });
});

describe("applyBackfill", () => {
    it("does nothing for an empty plan", async () => {
        const client = makeClient();
        await applyBackfill(client, "db", {
            dataset: "d",
            sql: "SELECT 1",
            domains: [],
            timezone: "Etc/UTC",
        });
        expect(client.executeD1Statement).not.toHaveBeenCalled();
    });

    it("executes the rerun-safe insert statement for non-empty plans", async () => {
        const client = makeClient();
        const plan = {
            dataset: "d",
            sql: "SELECT 1",
            domains: ["example.com"],
            timezone: "Etc/UTC",
        };
        await applyBackfill(client, "db", plan);
        expect(client.executeD1Statement).toHaveBeenCalledTimes(1);
        expect(client.executeD1Statement).toHaveBeenCalledWith(
            "db",
            expect.stringContaining("INSERT INTO sites"),
        );
    });

    it("splits large plans into sequential batches, each with idempotency checks", async () => {
        const client = makeClient();
        const domains = Array.from({ length: 250 }, (_, i) => `site${i}.com`);
        const plan = {
            dataset: "d",
            sql: "SELECT 1",
            domains,
            timezone: "Etc/UTC",
        };
        await applyBackfill(client, "db", plan);
        // 250 domains / 100 per batch => 3 statements.
        expect(client.executeD1Statement).toHaveBeenCalledTimes(3);
        const calls = (client.executeD1Statement as ReturnType<typeof vi.fn>)
            .mock.calls as unknown as [string, string][];
        for (const [, sql] of calls) {
            expect(sql).toContain(
                "WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.domain = candidate.domain)",
            );
        }
    });

    it("is fail-closed: stops on the first failed batch and does not continue", async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("D1 batch failed"));
        const client = makeClient({ executeD1Statement: execute });
        const domains = Array.from({ length: 250 }, (_, i) => `site${i}.com`);
        const plan = {
            dataset: "d",
            sql: "SELECT 1",
            domains,
            timezone: "Etc/UTC",
        };
        await expect(applyBackfill(client, "db", plan)).rejects.toThrow(
            "D1 batch failed",
        );
        expect(execute).toHaveBeenCalledTimes(2);
    });
});

describe("resolveNoomersApiToken", () => {
    const deps = {
        promptNew: vi.fn().mockResolvedValue("user-provided-token"),
        promptExisting: vi.fn().mockResolvedValue("existing-token"),
        writeBoth: vi.fn().mockResolvedValue(true),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("accepts and stores a user-provided token on a fresh install (never auto-generates)", async () => {
        const result = await resolveNoomersApiToken({}, deps);
        expect(result).toEqual({
            token: "user-provided-token",
            stored: true,
        });
        expect(deps.promptNew).toHaveBeenCalledTimes(1);
        expect(deps.writeBoth).toHaveBeenCalledWith("user-provided-token");
        expect(deps.promptExisting).not.toHaveBeenCalled();
    });

    it("prompts for the existing token when both secrets exist and never writes/rotates", async () => {
        const result = await resolveNoomersApiToken(
            { STATS_API_TOKEN: "s", SITES_API_TOKEN: "t" },
            deps,
        );
        expect(result).toEqual({ token: "existing-token", stored: false });
        expect(deps.promptExisting).toHaveBeenCalledTimes(1);
        expect(deps.writeBoth).not.toHaveBeenCalled();
    });

    it("prompts for the existing token and does not implicitly create the missing secret", async () => {
        const result = await resolveNoomersApiToken(
            { STATS_API_TOKEN: "s" },
            deps,
        );
        expect(result.stored).toBe(false);
        expect(deps.writeBoth).not.toHaveBeenCalled();

        const resultSitesOnly = await resolveNoomersApiToken(
            { SITES_API_TOKEN: "t" },
            deps,
        );
        expect(resultSitesOnly.stored).toBe(false);
        expect(deps.writeBoth).not.toHaveBeenCalled();
    });

    it("throws when writing both secrets fails on a fresh install", async () => {
        deps.writeBoth.mockResolvedValueOnce(false);
        await expect(resolveNoomersApiToken({}, deps)).rejects.toThrow(
            "Error setting Stats/Sites API token",
        );
    });
});

describe("presentBackfill (fail-closed)", () => {
    const plan = {
        dataset: "d",
        sql: "SELECT 1",
        domains: ["example.com"],
        timezone: "Etc/UTC",
    };

    it("returns null for an empty plan", async () => {
        const result = await presentBackfill({
            discover: async () => ({ ...plan, domains: [] }),
            confirm: vi.fn(),
            log: vi.fn(),
        });
        expect(result).toBeNull();
    });

    it("returns the confirmed plan for a nonempty plan", async () => {
        const result = await presentBackfill({
            discover: async () => plan,
            confirm: async () => true,
            log: vi.fn(),
        });
        expect(result).toEqual(plan);
    });

    it("throws (aborts) when the user declines a nonempty plan", async () => {
        await expect(
            presentBackfill({
                discover: async () => plan,
                confirm: async () => false,
                log: vi.fn(),
            }),
        ).rejects.toThrow(/declined/);
    });

    it("propagates discovery errors instead of continuing", async () => {
        await expect(
            presentBackfill({
                discover: async () => {
                    throw new Error("Analytics Engine query failed");
                },
                confirm: vi.fn(),
                log: vi.fn(),
            }),
        ).rejects.toThrow("Analytics Engine query failed");
    });
});

describe("provisionInitialSite", () => {
    it("provisions and verifies successfully", async () => {
        const log = vi.fn();
        await provisionInitialSite({
            provision: async () => ({ site: {}, created: true }),
            verifyAuth: async () => true,
            log,
        });
        expect(log).toHaveBeenCalled();
    });

    it("throws when auth verification fails", async () => {
        await expect(
            provisionInitialSite({
                provision: async () => ({ site: {}, created: true }),
                verifyAuth: async () => false,
                log: vi.fn(),
            }),
        ).rejects.toThrow(/Could not verify Sites API authentication/);
    });

    it("propagates provisioning errors", async () => {
        await expect(
            provisionInitialSite({
                provision: async () => {
                    throw new Error("Sites API POST failed");
                },
                verifyAuth: vi.fn(),
                log: vi.fn(),
            }),
        ).rejects.toThrow("Sites API POST failed");
    });
});

describe("install flow orchestration (existing-token + fail-closed backfill)", () => {
    const cloudflare = makeClient();
    const deployUrl = "https://app.example.workers.dev";

    it("prompts for the existing token on an existing install and uses it to provision", async () => {
        // Existing install: both secrets present.
        const secrets = { STATS_API_TOKEN: "s", SITES_API_TOKEN: "t" };
        const promptExisting = vi.fn().mockResolvedValue("existing-token");
        const writeBoth = vi.fn().mockResolvedValue(true);

        const { token } = await resolveNoomersApiToken(secrets, {
            promptNew: vi.fn(),
            promptExisting,
            writeBoth,
        });

        expect(token).toBe("existing-token");
        expect(promptExisting).toHaveBeenCalledTimes(1);
        expect(writeBoth).not.toHaveBeenCalled();

        // The prompted token is then used to provision the initial site.
        (
            cloudflare.getSiteByDomain as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);
        (cloudflare.createSite as ReturnType<typeof vi.fn>).mockResolvedValue({
            domain: "example.com",
        });
        const provisioned = await provisionSiteIdempotently(
            cloudflare,
            deployUrl,
            token,
            "example.com",
            "Etc/UTC",
        );
        expect(provisioned.created).toBe(true);
        expect(cloudflare.createSite).toHaveBeenCalledWith(
            deployUrl,
            "existing-token",
            "example.com",
            "Etc/UTC",
        );
    });

    it("aborts the install (throws) when a nonempty backfill is declined", async () => {
        await expect(
            presentBackfill({
                discover: async () => ({
                    dataset: "d",
                    sql: "SELECT 1",
                    domains: ["historical.com"],
                    timezone: "Etc/UTC",
                }),
                confirm: async () => false,
                log: vi.fn(),
            }),
        ).rejects.toThrow(/declined/);
    });

    it("aborts the install (throws) when historical discovery fails", async () => {
        (
            cloudflare.queryAnalyticsEngine as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error("Analytics Engine query failed"));
        await expect(
            discoverHistoricalSites(
                cloudflare,
                "acct",
                "token",
                "metricsDataset",
                "Etc/UTC",
            ),
        ).rejects.toThrow("Analytics Engine query failed");
    });
});
