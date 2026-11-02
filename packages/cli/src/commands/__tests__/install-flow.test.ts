process.env.NODE_ENV = "test";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
    DEPLOYMENT_CONFIG_PATH,
    DEPLOYMENT_METADATA_PATH,
} from "../../lib/config.js";

/**
 * Mutable state shared between the install flow and the `node:fs` mock. Lets
 * tests simulate a previously persisted deployment (fresh install vs. upgrade)
 * and capture every file the installer would have written.
 */
const fsState = vi.hoisted(() => ({
    persistedConfig: null as string | null,
    persistedMetadata: null as string | null,
    writtenFiles: [] as Array<{ path: string; content: string }>,
}));

/**
 * Mutable defaults consumed by the mocked CloudflareClient so the confirmed
 * deploy path can be driven end-to-end without Cloudflare access.
 */
const clientState = vi.hoisted(() => ({
    databaseId: "database-id",
    deployUrl: "https://app.custom.workers.dev",
    queryData: { data: [] } as Record<string, unknown>,
}));

/**
 * The most recently constructed CloudflareClient mock instance. The mock
 * factory captures the instance `install` creates so tests can assert on the
 * exact object used during the run.
 */
let clientInstance: Record<string, ReturnType<typeof vi.fn>> | undefined;

vi.mock("../../lib/cloudflare.js", () => {
    const CloudflareClient = vi.fn().mockImplementation(function () {
        clientInstance = {
            getAccounts: vi.fn().mockResolvedValue([
                {
                    id: "1234567890abcdef1234567890abcdef",
                    name: "Account 1",
                },
            ]),
            getCloudflareSecrets: vi.fn().mockResolvedValue({}),
            setCloudflareSecrets: vi.fn().mockResolvedValue(true),
            getOrCreateR2Bucket: vi.fn().mockResolvedValue("existing"),
            getOrCreateD1Database: vi
                .fn()
                .mockImplementation(async () => clientState.databaseId),
            applyD1Migrations: vi.fn().mockResolvedValue(undefined),
            executeD1Statement: vi.fn().mockResolvedValue(undefined),
            queryAnalyticsEngine: vi
                .fn()
                .mockImplementation(async () => clientState.queryData),
            deploy: vi
                .fn()
                .mockImplementation(async () => clientState.deployUrl),
            getSiteByDomain: vi.fn().mockResolvedValue(null),
            createSite: vi.fn().mockResolvedValue({}),
            verifySitesApiAuth: vi.fn().mockResolvedValue(true),
        };
        return clientInstance;
    });
    (
        CloudflareClient as unknown as {
            validateToken: ReturnType<typeof vi.fn>;
        }
    ).validateToken = vi.fn().mockResolvedValue({ valid: true });
    return { CloudflareClient };
});

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        existsSync: vi.fn((p: unknown) => {
            if (p === DEPLOYMENT_CONFIG_PATH) {
                return fsState.persistedConfig !== null;
            }
            if (p === DEPLOYMENT_METADATA_PATH) {
                return fsState.persistedMetadata !== null;
            }
            return actual.existsSync(p as string);
        }),
        readFileSync: vi.fn((p: unknown, ...args: unknown[]) => {
            if (p === DEPLOYMENT_CONFIG_PATH) {
                if (fsState.persistedConfig === null) {
                    throw new Error(`ENOENT: ${String(p)}`);
                }
                return fsState.persistedConfig;
            }
            if (p === DEPLOYMENT_METADATA_PATH) {
                if (fsState.persistedMetadata === null) {
                    throw new Error(`ENOENT: ${String(p)}`);
                }
                return fsState.persistedMetadata;
            }
            return (actual.readFileSync as (...a: unknown[]) => unknown)(
                p,
                ...args,
            );
        }),
        writeFileSync: vi.fn(
            (p: unknown, content: unknown, ...args: unknown[]) => {
                fsState.writtenFiles.push({
                    path: p as string,
                    content: content as string,
                });
                // Never touch a real ~/.noomers deployment from a test.
                if (
                    p === DEPLOYMENT_CONFIG_PATH ||
                    p === DEPLOYMENT_METADATA_PATH
                ) {
                    return;
                }
                return (actual.writeFileSync as (...a: unknown[]) => unknown)(
                    p,
                    content,
                    ...args,
                );
            },
        ),
        mkdirSync: vi.fn(() => undefined),
    };
});

vi.mock("@clack/prompts", () => {
    const confirm = vi.fn();
    return {
        isCancel: vi.fn(),
        cancel: vi.fn(),
        password: vi.fn(),
        confirm,
        text: vi.fn(),
        select: vi.fn(),
        intro: vi.fn(),
        outro: vi.fn(),
        note: vi.fn(),
        spinner: vi.fn(() => ({
            start: vi.fn(),
            stop: vi.fn(),
        })),
        log: {
            info: vi.fn(),
        },
    };
});

import { isCancel, confirm, password, text } from "@clack/prompts";
import { install } from "../install.js";

const CUSTOM_PERSISTED_CONFIG = {
    name: "custom-worker",
    analytics_engine_datasets: [
        { binding: "WEB_COUNTER_AE", dataset: "custom-dataset" },
    ],
    pipelines: [{ binding: "EVENT_STREAM", stream: "noomers-events" }],
    vars: {
        R2_SQL_BUCKET: "custom-warehouse",
        R2_SQL_TABLE: "default.events",
    },
    r2_buckets: [
        {
            binding: "DAILY_ROLLUPS",
            bucket_name: "custom-worker-daily-rollups",
        },
    ],
};

const CUSTOM_PERSISTED_METADATA = {
    version: 1,
    accountId: "1234567890abcdef1234567890abcdef",
    workerName: "custom-worker",
    analyticsDataset: "custom-dataset",
    d1Database: { name: "custom-worker-goals", id: "database-id" },
    resources: {
        dailyRollupsBucket: "custom-worker-daily-rollups",
    },
};

function stagedConfigWrites() {
    return fsState.writtenFiles.filter(
        (w) =>
            w.path !== DEPLOYMENT_CONFIG_PATH &&
            w.path !== DEPLOYMENT_METADATA_PATH,
    );
}

describe("install flow safety", () => {
    let mockExit: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        clientInstance = undefined;
        fsState.persistedConfig = null;
        fsState.persistedMetadata = null;
        fsState.writtenFiles = [];
        // Reset prompt implementations and once-queues so queued values from
        // one test never leak into the next.
        (confirm as unknown as ReturnType<typeof vi.fn>).mockReset();
        (password as unknown as ReturnType<typeof vi.fn>).mockReset();
        (text as unknown as ReturnType<typeof vi.fn>).mockReset();
        mockExit = vi
            .spyOn(process, "exit")
            .mockImplementation((..._args: unknown[]) => {
                throw new Error("process.exit should not be called");
            });
    });

    afterEach(() => {
        mockExit.mockRestore();
    });

    it("causes no mutating Cloudflare calls when the deploy prompt is declined", async () => {
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );

        await install({ advanced: false, verbose: false }, "/some/server/dir", {
            version: "1.0.0",
        });

        const client = clientInstance;
        expect(client).toBeDefined();
        // Read-only secret listing may occur before confirmation.
        expect(client!.getCloudflareSecrets).toHaveBeenCalled();
        // Every mutating Cloudflare operation must be skipped on decline.
        expect(client!.setCloudflareSecrets).not.toHaveBeenCalled();
        expect(client!.getOrCreateR2Bucket).not.toHaveBeenCalled();
        expect(client!.getOrCreateD1Database).not.toHaveBeenCalled();
        expect(client!.applyD1Migrations).not.toHaveBeenCalled();
        expect(client!.executeD1Statement).not.toHaveBeenCalled();
        expect(client!.deploy).not.toHaveBeenCalled();
    });

    it("uses package defaults on a fresh install with no persisted configuration", async () => {
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );

        await install({ advanced: false, verbose: false }, "/some/server/dir", {
            version: "1.0.0",
        });

        const stagedWrites = stagedConfigWrites();
        expect(stagedWrites.length).toBeGreaterThan(0);
        const staged = JSON.parse(
            stagedWrites[stagedWrites.length - 1].content,
        );

        expect(staged.name).toBe("noomers-local");
        if (staged.analytics_engine_datasets) {
            expect(staged.analytics_engine_datasets[0].dataset).toBe(
                "metricsDataset",
            );
        }
        expect(staged.pipelines).toBeDefined(); // base config ships EVENT_STREAM
        expect(staged.vars ?? {}).toEqual({});
    });

    it("preserves the persisted custom worker, dataset, EVENT_STREAM pipeline, and R2 SQL vars without Cloudflare mutation", async () => {
        fsState.persistedConfig = JSON.stringify(CUSTOM_PERSISTED_CONFIG);
        fsState.persistedMetadata = JSON.stringify(CUSTOM_PERSISTED_METADATA);
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );

        await install({ advanced: false, verbose: false }, "/some/server/dir", {
            version: "1.0.0",
        });

        const stagedWrites = stagedConfigWrites();
        expect(stagedWrites.length).toBeGreaterThan(0);
        const staged = JSON.parse(
            stagedWrites[stagedWrites.length - 1].content,
        );

        expect(staged.name).toBe("custom-worker");
        if (staged.analytics_engine_datasets) {
            expect(staged.analytics_engine_datasets[0].dataset).toBe(
                "custom-dataset",
            );
        }
        expect(staged.pipelines).toEqual([
            { binding: "EVENT_STREAM", stream: "noomers-events" },
        ]);
        expect(staged.vars).toEqual({
            R2_SQL_BUCKET: "custom-warehouse",
            R2_SQL_TABLE: "default.events",
        });

        const client = clientInstance;
        expect(client!.getCloudflareSecrets).toHaveBeenCalled();
        expect(client!.setCloudflareSecrets).not.toHaveBeenCalled();
        expect(client!.getOrCreateR2Bucket).not.toHaveBeenCalled();
        expect(client!.getOrCreateD1Database).not.toHaveBeenCalled();
        expect(client!.applyD1Migrations).not.toHaveBeenCalled();
        expect(client!.executeD1Statement).not.toHaveBeenCalled();
        expect(client!.deploy).not.toHaveBeenCalled();
    });

    it("aborts on a stale EVENTS_PIPELINE binding before any Cloudflare call or staged write", async () => {
        fsState.persistedConfig = JSON.stringify({
            ...CUSTOM_PERSISTED_CONFIG,
            pipelines: [{ binding: "EVENTS_PIPELINE", pipeline: "stale" }],
        });
        fsState.persistedMetadata = JSON.stringify(CUSTOM_PERSISTED_METADATA);
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );

        await expect(
            install({ advanced: false, verbose: false }, "/some/server/dir", {
                version: "1.0.0",
            }),
        ).rejects.toThrow(/Stale pipeline binding "EVENTS_PIPELINE"/);

        // The CloudflareClient is never constructed: no Cloudflare call at all,
        // and no staged config was written.
        expect(clientInstance).toBeUndefined();
        expect(stagedConfigWrites()).toHaveLength(0);
    });

    it("migrates a legacy `pipeline` field to `stream` on reinstall", async () => {
        fsState.persistedConfig = JSON.stringify({
            ...CUSTOM_PERSISTED_CONFIG,
            pipelines: [
                { binding: "EVENT_STREAM", pipeline: "noomers-events" },
            ],
        });
        fsState.persistedMetadata = JSON.stringify(CUSTOM_PERSISTED_METADATA);
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );

        await install({ advanced: false, verbose: false }, "/some/server/dir", {
            version: "1.0.0",
        });

        const stagedWrites = stagedConfigWrites();
        expect(stagedWrites.length).toBeGreaterThan(0);
        const staged = JSON.parse(
            stagedWrites[stagedWrites.length - 1].content,
        );

        expect(staged.pipelines).toEqual([
            { binding: "EVENT_STREAM", stream: "noomers-events" },
        ]);
    });

    it("uses the preserved worker and dataset as advanced prompt defaults", async () => {
        fsState.persistedConfig = JSON.stringify(CUSTOM_PERSISTED_CONFIG);
        fsState.persistedMetadata = JSON.stringify(CUSTOM_PERSISTED_METADATA);
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            false,
        );
        const textMock = text as unknown as ReturnType<typeof vi.fn>;
        textMock
            .mockResolvedValueOnce("custom-worker")
            .mockResolvedValueOnce("custom-dataset");

        await install({ advanced: true, verbose: false }, "/some/server/dir", {
            version: "1.0.0",
        });

        // The advanced prompts must default to the preserved identity, not the
        // server package defaults.
        expect(textMock).toHaveBeenCalledWith(
            expect.objectContaining({ initialValue: "custom-worker" }),
        );
        expect(textMock).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("worker") }),
        );
    });

    it("targets the preserved Analytics Engine dataset during upgrade backfill and persists pipeline/R2 SQL metadata", async () => {
        fsState.persistedConfig = JSON.stringify(CUSTOM_PERSISTED_CONFIG);
        fsState.persistedMetadata = JSON.stringify(CUSTOM_PERSISTED_METADATA);
        (isCancel as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        (confirm as unknown as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        (password as unknown as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce("a".repeat(40))
            .mockResolvedValueOnce("b".repeat(32))
            .mockResolvedValueOnce("c".repeat(8));
        (text as unknown as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce("example.com")
            .mockResolvedValueOnce("Etc/UTC");

        await install({ advanced: false, verbose: false }, "/some/server/dir", {
            version: "1.0.0",
        });

        const client = clientInstance;
        expect(client).toBeDefined();
        expect(client!.deploy).toHaveBeenCalled();

        // The preserved custom worker name must drive the D1 database name.
        expect(client!.getOrCreateD1Database).toHaveBeenCalledWith(
            "custom-worker-goals",
        );

        // The upgrade backfill must query the preserved custom dataset, never
        // the server package default.
        expect(client!.queryAnalyticsEngine).toHaveBeenCalled();
        for (const call of client!.queryAnalyticsEngine.mock.calls) {
            expect(call[2]).toContain('FROM "custom-dataset"');
        }

        // The deployed Wrangler config keeps the custom name, dataset,
        // EVENT_STREAM pipeline binding, and R2 SQL vars.
        const deployedWrite = fsState.writtenFiles.find(
            (w) => w.path === DEPLOYMENT_CONFIG_PATH,
        );
        expect(deployedWrite).toBeDefined();
        const deployedConfig = JSON.parse(deployedWrite!.content);
        expect(deployedConfig.name).toBe("custom-worker");
        if (deployedConfig.analytics_engine_datasets) {
            expect(
                deployedConfig.analytics_engine_datasets[0].dataset,
            ).toBe("custom-dataset");
        }
        expect(deployedConfig.pipelines).toEqual([
            { binding: "EVENT_STREAM", stream: "noomers-events" },
        ]);
        expect(deployedConfig.vars).toEqual({
            R2_SQL_BUCKET: "custom-warehouse",
            R2_SQL_TABLE: "default.events",
        });

        // Deployment metadata records the preserved pipeline and R2 SQL values.
        const metadataWrite = fsState.writtenFiles.find(
            (w) => w.path === DEPLOYMENT_METADATA_PATH,
        );
        expect(metadataWrite).toBeDefined();
        const metadata = JSON.parse(metadataWrite!.content);
        expect(metadata.workerName).toBe("custom-worker");
        expect(metadata.analyticsDataset).toBe("custom-dataset");
        expect(metadata.resources.pipelineName).toBe("noomers-events");
        expect(metadata.resources.dataCatalogBucket).toBe("custom-warehouse");
        expect(metadata.resources.dataCatalogTable).toBe("default.events");
    });
});
