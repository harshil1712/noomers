import inquirer from "inquirer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    getServerPkgDir,
    getWorkerAndDatasetName,
    getDeploymentConfigPath,
    makePathsAbsolute,
    normalizePipelines,
    persistDeployment,
    readInitialServerConfig,
    stageDeployConfig,
    suggestPipelineName,
    DEPLOYMENT_CONFIG_PATH,
    DEPLOYMENT_METADATA_PATH,
    resolvePipelineName,
    resolveDailyRollupsBucket,
    deriveDailyRollupsBucket,
    R2_BUCKET_MAX_LENGTH,
    readPersistedDeploymentConfig,
    resolveWorkerAndDataset,
} from "../config.js";

// Mock external dependencies
vi.mock("inquirer", () => ({
    default: {
        prompt: vi.fn(),
    },
}));

vi.mock("figlet", () => ({
    default: {
        textSync: vi.fn(() => "noomers"),
    },
}));

vi.mock("path", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:path")>();
    return {
        ...actual,
        dirname: vi.fn(() => "/some/path/to/somewhere"),
    };
});

vi.mock("url", async (importOriginal) => {
    const actual = await importOriginal<typeof import("url")>();
    return {
        ...actual,
        fileURLToPath: vi.fn(() => "/some/path/to/somewhere/config.js"),
    };
});

// Mock fs methods
vi.mock("node:fs", async () => {
    const actual = await vi.importActual("node:fs");
    return {
        ...actual,
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(() => "{}"),
        writeFileSync: vi.fn(),
    };
});

describe("CLI Functions", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(inquirer.prompt).mockResolvedValue({
            workerName: "test-worker",
            analyticsDataset: "test-dataset",
        });
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe("getServerPkgDir", () => {
        it("should find package in node_modules", async () => {
            const { dirname } = await import("path");
            const { existsSync } = await import("node:fs");
            const { fileURLToPath } = await import("url");

            // Mock fileURLToPath to return a specific path
            vi.mocked(fileURLToPath).mockReturnValue(
                "/some/path/to/node_modules/@noomers/cli/dist/config.js",
            );

            // Mock dirname to return the directory
            vi.mocked(dirname).mockReturnValue(
                "/some/path/to/node_modules/@noomers/cli/dist",
            );

            // Mock existsSync to return true only for the node_modules path
            // The actual path construction goes up 4 levels from __dirname then to @noomers/server
            const expectedPath = "/some/path/to/@noomers/server";
            vi.mocked(existsSync).mockImplementation((p) => p === expectedPath);

            const result = getServerPkgDir();

            expect(existsSync).toBeCalled();
            expect(result).toBe(expectedPath);
            expect(existsSync).toHaveBeenCalledWith(expectedPath);
        });

        it("should check monorepo path if node_modules not found", async () => {
            const { dirname } = await import("path");
            const { existsSync } = await import("node:fs");
            const { fileURLToPath } = await import("url");

            // Mock fileURLToPath to return a monorepo path
            vi.mocked(fileURLToPath).mockReturnValue(
                "/monorepo/checkout/noomers/packages/cli/dist/config.js",
            );

            vi.mocked(dirname).mockReturnValue(
                "/monorepo/checkout/noomers/packages/cli/dist",
            );

            // Mock existsSync to return false for node_modules but true for monorepo path
            const expectedPath = "/monorepo/checkout/packages/server";
            vi.mocked(existsSync).mockImplementation((p) => p === expectedPath);

            const result = getServerPkgDir();
            expect(result).toMatch(/packages\/server$/);
        });

        it("should throw if package not found", async () => {
            const { existsSync } = await import("node:fs");
            // Mock both paths to not exist
            vi.mocked(existsSync).mockReturnValue(false);

            expect(() => getServerPkgDir()).toThrow(
                /Could not find @noomers\/server package/,
            );
        });
    });

    describe("makePathsAbsolute", () => {
        it("should convert relative paths to absolute in a flat object", () => {
            const input = {
                path1: "relative/path/file.txt",
                path2: "/absolute/path/file.txt",
                nonPath: "string-without-slash",
            };
            const baseDir = "/base/dir";

            const result = makePathsAbsolute(input, baseDir);

            expect(result).toEqual({
                path1: "/base/dir/relative/path/file.txt",
                path2: "/absolute/path/file.txt",
                nonPath: "string-without-slash",
            });
        });

        it("should handle nested objects", () => {
            const input = {
                nested: {
                    path: "relative/nested/file.txt",
                    config: {
                        location: "another/path/config.json",
                    },
                },
                topLevel: "/absolute/top/level.txt",
            };
            const baseDir = "/root";

            const result = makePathsAbsolute(input, baseDir);

            expect(result).toEqual({
                nested: {
                    path: "/root/relative/nested/file.txt",
                    config: {
                        location: "/root/another/path/config.json",
                    },
                },
                topLevel: "/absolute/top/level.txt",
            });
        });

        it("should handle arrays", () => {
            const input = {
                paths: [
                    "relative/path1.txt",
                    "/absolute/path2.txt",
                    { nestedPath: "relative/path3.txt" },
                ],
            };
            const baseDir = "/base";

            const result = makePathsAbsolute(input, baseDir);

            expect(result).toEqual({
                paths: [
                    "/base/relative/path1.txt",
                    "/absolute/path2.txt",
                    { nestedPath: "/base/relative/path3.txt" },
                ],
            });
        });

        it("should handle non-object inputs", () => {
            expect(makePathsAbsolute(null, "/base")).toBeNull();
            expect(makePathsAbsolute(undefined, "/base")).toBeUndefined();
            expect(makePathsAbsolute("simple/path", "/base")).toBe(
                "simple/path",
            );
            expect(makePathsAbsolute(42, "/base")).toBe(42);
        });
    });

    describe("getWorkerAndDatasetName", () => {
        it("should extract worker name and dataset from config", () => {
            const config = {
                name: "test-worker",
                analytics_engine_datasets: [{ dataset: "test-dataset" }],
            };

            const result = getWorkerAndDatasetName(config);

            expect(result).toEqual({
                workerName: "test-worker",
                analyticsDataset: "test-dataset",
            });
        });
    });

    describe("readInitialServerConfig", () => {
        it("should read and parse wrangler.json from server package", async () => {
            const mockConfig = {
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "default-dataset" }],
            };

            // Mock existsSync to make getServerPkgDir work
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);

            // Mock readFileSync
            const { readFileSync } = await import("node:fs");
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

            const result = readInitialServerConfig();

            expect(result).toEqual(mockConfig);
            expect(readFileSync).toHaveBeenCalledWith(
                expect.stringMatching(/wrangler\.json$/),
                "utf8",
            );
        });
    });

    describe("stageDeployConfig", () => {
        it("should write updated config with absolute paths", async () => {
            // Mock existsSync to make getServerPkgDir work
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "old-name",
                analytics_engine_datasets: [{ dataset: "old-dataset" }],
                build: {
                    command: "npm run build",
                    cwd: "relative/path",
                },
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
            );

            // Verify writeFileSync was called with the correct arguments
            expect(writeFileSync).toHaveBeenCalledWith(
                "/target/wrangler.json",
                expect.any(String),
            );

            // Parse the written config to verify its contents
            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            // Verify worker name and dataset were updated
            expect(writtenConfig.name).toBe("new-worker");
            expect(writtenConfig.analytics_engine_datasets[0].dataset).toBe(
                "new-dataset",
            );

            // Verify paths were made absolute
            expect(writtenConfig.build.cwd).toMatch(/^\//); // Should start with /
        });

        it("should include account_id when provided", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "old-name",
                analytics_engine_datasets: [{ dataset: "old-dataset" }],
            };

            const accountId = "1234567890abcdef1234567890abcdef";

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
                accountId,
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.account_id).toBe(accountId);
        });

        it("should not include account_id when not provided", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "old-name",
                analytics_engine_datasets: [{ dataset: "old-dataset" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.account_id).toBeUndefined();
        });

        it("should set the DAILY_ROLLUPS bucket and preview bucket names", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "old-name",
                analytics_engine_datasets: [{ dataset: "old-dataset" }],
                r2_buckets: [
                    {
                        binding: "DAILY_ROLLUPS",
                        bucket_name: "hardcoded-bucket",
                        preview_bucket_name: "hardcoded-bucket-dev",
                    },
                ],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
                undefined,
                undefined,
                {
                    bucket: "new-worker-daily-rollups",
                    previewBucket: "new-worker-daily-rollups-dev",
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.r2_buckets[0].bucket_name).toBe(
                "new-worker-daily-rollups",
            );
            expect(writtenConfig.r2_buckets[0].preview_bucket_name).toBe(
                "new-worker-daily-rollups-dev",
            );
        });

        it("should locate the DAILY_ROLLUPS binding via find, not position", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "old-name",
                analytics_engine_datasets: [{ dataset: "old-dataset" }],
                r2_buckets: [
                    {
                        binding: "ASSETS",
                        bucket_name: "unrelated-bucket",
                    },
                    {
                        binding: "DAILY_ROLLUPS",
                        bucket_name: "hardcoded-bucket",
                        preview_bucket_name: "hardcoded-bucket-dev",
                    },
                ],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
                undefined,
                undefined,
                {
                    bucket: "new-worker-daily-rollups",
                    previewBucket: "new-worker-daily-rollups-dev",
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.r2_buckets[0].bucket_name).toBe(
                "unrelated-bucket",
            );
            expect(writtenConfig.r2_buckets[1].bucket_name).toBe(
                "new-worker-daily-rollups",
            );
            expect(writtenConfig.r2_buckets[1].preview_bucket_name).toBe(
                "new-worker-daily-rollups-dev",
            );
        });

        it("should not override a bucket when no DAILY_ROLLUPS binding exists", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "old-name",
                analytics_engine_datasets: [{ dataset: "old-dataset" }],
                r2_buckets: [{ binding: "OTHER", bucket_name: "other-bucket" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
                undefined,
                undefined,
                {
                    bucket: "new-worker-daily-rollups",
                    previewBucket: "new-worker-daily-rollups-dev",
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.r2_buckets[0].bucket_name).toBe(
                "other-bucket",
            );
        });

        it("preserves the persisted EVENT_STREAM pipeline binding on reinstall", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "custom-worker",
                "custom-dataset",
                undefined,
                undefined,
                undefined,
                {
                    workerName: "custom-worker",
                    analyticsDataset: "custom-dataset",
                    pipelines: [
                        { binding: "EVENT_STREAM", stream: "noomers-events" },
                    ],
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.pipelines).toEqual([
                { binding: "EVENT_STREAM", stream: "noomers-events" },
            ]);
        });

        it("normalizes a legacy `pipeline` field to `stream` on reinstall", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "custom-worker",
                "custom-dataset",
                undefined,
                undefined,
                undefined,
                {
                    workerName: "custom-worker",
                    analyticsDataset: "custom-dataset",
                    pipelines: [
                        { binding: "EVENT_STREAM", pipeline: "noomers-events" },
                    ],
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.pipelines).toEqual([
                { binding: "EVENT_STREAM", stream: "noomers-events" },
            ]);
        });

        it("preserves the persisted R2 SQL vars on reinstall", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "custom-worker",
                "custom-dataset",
                undefined,
                undefined,
                undefined,
                {
                    workerName: "custom-worker",
                    analyticsDataset: "custom-dataset",
                    vars: {
                        R2_SQL_BUCKET: "custom-warehouse",
                        R2_SQL_TABLE: "default.events",
                    },
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.vars).toEqual({
                R2_SQL_BUCKET: "custom-warehouse",
                R2_SQL_TABLE: "default.events",
            });
        });

        it("sets the runtime ANALYTICS_DATASET var on a fresh install", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "new-worker",
                "new-dataset",
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.pipelines).toBeUndefined();
            // ANALYTICS_DATASET is no longer written; Analytics Engine was removed.
            expect(writtenConfig.vars).toBeUndefined();
        });

        it("preserves vars on reinstall without adding ANALYTICS_DATASET", async () => {
            const { existsSync, writeFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(writeFileSync);

            const initialConfig = {
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            };

            await stageDeployConfig(
                "/target/wrangler.json",
                initialConfig,
                "custom-worker",
                "custom-dataset",
                undefined,
                undefined,
                undefined,
                {
                    workerName: "custom-worker",
                    analyticsDataset: "custom-dataset",
                    vars: {
                        R2_SQL_BUCKET: "custom-warehouse",
                        R2_SQL_TABLE: "default.events",
                    },
                },
            );

            const writtenConfig = JSON.parse(
                vi.mocked(writeFileSync).mock.calls[0][1] as string,
            );

            expect(writtenConfig.vars).toEqual({
                R2_SQL_BUCKET: "custom-warehouse",
                R2_SQL_TABLE: "default.events",
            });
        });
    });

    describe("installed deployment", () => {
        it("returns the persisted Wrangler config", async () => {
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);

            expect(getDeploymentConfigPath()).toBe(DEPLOYMENT_CONFIG_PATH);
        });

        it("fails clearly when no deployment is installed", async () => {
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(false);

            expect(() => getDeploymentConfigPath()).toThrow(
                /Run noomers install first/,
            );
        });

        it("persists the staged config and deployment metadata", async () => {
            const { mkdirSync, readFileSync, writeFileSync } = await import(
                "node:fs"
            );
            vi.mocked(readFileSync).mockReturnValue('{"name":"worker"}');
            const metadata = {
                version: 1 as const,
                accountId: "account-id",
                workerName: "worker",
                analyticsDataset: "dataset",
                d1Database: { name: "worker-goals", id: "database-id" },
                resources: { dailyRollupsBucket: "daily-rollups" },
            };

            persistDeployment("/tmp/wrangler.json", metadata);

            expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), {
                recursive: true,
                mode: 0o700,
            });
            expect(writeFileSync).toHaveBeenCalledWith(
                DEPLOYMENT_CONFIG_PATH,
                '{"name":"worker"}',
                { mode: 0o600 },
            );
            expect(writeFileSync).toHaveBeenCalledWith(
                DEPLOYMENT_METADATA_PATH,
                JSON.stringify(metadata, null, 2),
                { mode: 0o600 },
            );
        });

        it("persists the preview bucket alongside the main bucket in metadata", async () => {
            const { readFileSync, writeFileSync } = await import("node:fs");
            vi.mocked(readFileSync).mockReturnValue('{"name":"worker"}');
            const metadata = {
                version: 1 as const,
                accountId: "account-id",
                workerName: "worker",
                analyticsDataset: "dataset",
                d1Database: { name: "worker-goals", id: "database-id" },
                resources: {
                    dailyRollupsBucket: "daily-rollups",
                    dailyRollupsPreviewBucket: "daily-rollups-dev",
                },
            };

            persistDeployment("/tmp/wrangler.json", metadata);

            expect(writeFileSync).toHaveBeenCalledWith(
                DEPLOYMENT_METADATA_PATH,
                JSON.stringify(metadata, null, 2),
                { mode: 0o600 },
            );
        });
    });

    describe("readPersistedDeploymentConfig", () => {
        it("returns null when no persisted config exists (fresh install)", async () => {
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(false);

            expect(readPersistedDeploymentConfig()).toBeNull();
        });

        it("returns null for a malformed persisted config", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue("{ not json");

            expect(readPersistedDeploymentConfig()).toBeNull();
        });

        it("falls back to the default dataset when the persisted config lacks one", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"name": "worker"}');

            const parsed = readPersistedDeploymentConfig();
            expect(parsed?.analyticsDataset).toBe("events");
        });

        it("returns null when the persisted config has no worker name", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    analytics_engine_datasets: [{ dataset: "custom-dataset" }],
                }),
            );

            expect(readPersistedDeploymentConfig()).toBeNull();
        });

        it("falls back to the default dataset when the persisted dataset is empty", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    name: "custom-worker",
                    analytics_engine_datasets: [{ binding: "WEB_COUNTER_AE" }],
                }),
            );

            const parsed = readPersistedDeploymentConfig();
            expect(parsed?.analyticsDataset).toBe("events");
        });

        it("returns null when the persisted config has a blank worker name", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    name: "   ",
                    analytics_engine_datasets: [{ dataset: "custom-dataset" }],
                }),
            );

            expect(readPersistedDeploymentConfig()).toBeNull();
        });

        it("reads the persisted worker name, dataset, EVENT_STREAM pipeline, and R2 SQL vars", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    name: "custom-worker",
                    analytics_engine_datasets: [{ dataset: "custom-dataset" }],
                    pipelines: [
                        { binding: "EVENT_STREAM", stream: "noomers-events" },
                    ],
                    vars: {
                        R2_SQL_BUCKET: "custom-warehouse",
                        R2_SQL_TABLE: "default.events",
                    },
                }),
            );

            const result = readPersistedDeploymentConfig();

            expect(result).toEqual({
                workerName: "custom-worker",
                analyticsDataset: "custom-dataset",
                pipelines: [
                    { binding: "EVENT_STREAM", stream: "noomers-events" },
                ],
                vars: {
                    R2_SQL_BUCKET: "custom-warehouse",
                    R2_SQL_TABLE: "default.events",
                },
            });
        });

        it("synthesizes the EVENT_STREAM pipeline binding from persisted metadata when the config lacks pipelines", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "custom-worker",
                          analyticsDataset: "custom-dataset",
                          d1Database: { name: "db", id: "id" },
                          resources: {
                              pipelineName: "noomers-events",
                          },
                      })
                    : JSON.stringify({
                          name: "custom-worker",
                          analytics_engine_datasets: [
                              { dataset: "custom-dataset" },
                          ],
                      }),
            );

            const result = readPersistedDeploymentConfig();

            expect(result?.pipelines).toEqual([
                { binding: "EVENT_STREAM", stream: "noomers-events" },
            ]);
        });

        it("fills R2_SQL vars from persisted metadata when the config lacks them", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "custom-worker",
                          analyticsDataset: "custom-dataset",
                          d1Database: { name: "db", id: "id" },
                          resources: {
                              dataCatalogBucket: "custom-warehouse",
                              dataCatalogTable: "default.events",
                          },
                      })
                    : JSON.stringify({
                          name: "custom-worker",
                          analytics_engine_datasets: [
                              { dataset: "custom-dataset" },
                          ],
                      }),
            );

            const result = readPersistedDeploymentConfig();

            expect(result?.vars).toEqual({
                R2_SQL_BUCKET: "custom-warehouse",
                R2_SQL_TABLE: "default.events",
            });
        });

        it("never overrides an explicit config pipeline array or R2 SQL var with metadata", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "custom-worker",
                          analyticsDataset: "custom-dataset",
                          d1Database: { name: "db", id: "id" },
                          resources: {
                              pipelineName: "metadata-events",
                              dataCatalogBucket: "metadata-bucket",
                              dataCatalogTable: "metadata.events",
                          },
                      })
                    : JSON.stringify({
                          name: "custom-worker",
                          analytics_engine_datasets: [
                              { dataset: "custom-dataset" },
                          ],
                          pipelines: [
                              {
                                  binding: "EVENT_STREAM",
                                  stream: "config-events",
                              },
                          ],
                          vars: {
                              R2_SQL_BUCKET: "config-bucket",
                          },
                      }),
            );

            const result = readPersistedDeploymentConfig();

            expect(result?.pipelines).toEqual([
                { binding: "EVENT_STREAM", stream: "config-events" },
            ]);
            // Explicit config value wins; the missing table key is filled.
            expect(result?.vars).toEqual({
                R2_SQL_BUCKET: "config-bucket",
                R2_SQL_TABLE: "metadata.events",
            });
        });

        it("keeps an explicit empty pipelines array over the metadata fallback", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "custom-worker",
                          analyticsDataset: "custom-dataset",
                          d1Database: { name: "db", id: "id" },
                          resources: { pipelineName: "noomers-events" },
                      })
                    : JSON.stringify({
                          name: "custom-worker",
                          analytics_engine_datasets: [
                              { dataset: "custom-dataset" },
                          ],
                          pipelines: [],
                      }),
            );

            const result = readPersistedDeploymentConfig();

            expect(result?.pipelines).toEqual([]);
        });
    });

    describe("resolveWorkerAndDataset", () => {
        it("uses package defaults on a fresh install", async () => {
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(false);

            const result = resolveWorkerAndDataset({
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            });

            expect(result).toEqual({
                workerName: "noomers",
                analyticsDataset: "metricsDataset",
                preserved: false,
            });
        });

        it("prefers persisted deployment metadata over the persisted config and package defaults", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "metadata-worker",
                          analyticsDataset: "metadata-dataset",
                          d1Database: { name: "db", id: "id" },
                      })
                    : JSON.stringify({
                          name: "config-worker",
                          analytics_engine_datasets: [
                              { dataset: "config-dataset" },
                          ],
                      }),
            );

            const result = resolveWorkerAndDataset({
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            });

            expect(result).toEqual({
                workerName: "metadata-worker",
                analyticsDataset: "metadata-dataset",
                preserved: true,
            });
        });

        it("falls back to the persisted Wrangler config when no metadata exists", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockImplementation(
                (p: unknown) => p !== DEPLOYMENT_METADATA_PATH,
            );
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    name: "custom-worker",
                    analytics_engine_datasets: [{ dataset: "custom-dataset" }],
                }),
            );

            const result = resolveWorkerAndDataset({
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            });

            expect(result).toEqual({
                workerName: "custom-worker",
                analyticsDataset: "custom-dataset",
                preserved: true,
            });
        });

        it("ignores a malformed persisted config and falls back to package defaults", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockImplementation(
                (p: unknown) => p !== DEPLOYMENT_METADATA_PATH,
            );
            vi.mocked(readFileSync).mockReturnValue('{"not": "a deployment"}');

            const result = resolveWorkerAndDataset({
                name: "noomers",
                analytics_engine_datasets: [{ dataset: "metricsDataset" }],
            });

            expect(result).toEqual({
                workerName: "noomers",
                analyticsDataset: "metricsDataset",
                preserved: false,
            });
        });
    });

    describe("resolvePipelineName (FND-004)", () => {
        it("resolves the pipeline from the EVENT_STREAM binding", () => {
            expect(
                resolvePipelineName([
                    { binding: "EVENT_STREAM", stream: "noomers-events" },
                ]),
            ).toBe("noomers-events");
        });

        it("returns undefined when no pipelines are configured", () => {
            expect(resolvePipelineName(undefined)).toBeUndefined();
            expect(resolvePipelineName([])).toBeUndefined();
        });

        it("returns undefined for an EVENT_STREAM binding with no stream identifier", () => {
            expect(
                resolvePipelineName([{ binding: "EVENT_STREAM" }]),
            ).toBeUndefined();
        });

        it("resolves the legacy `pipeline` field on the EVENT_STREAM binding", () => {
            expect(
                resolvePipelineName([
                    { binding: "EVENT_STREAM", pipeline: "noomers-events" },
                ]),
            ).toBe("noomers-events");
        });

        it("prefers the current `stream` field over the legacy `pipeline` field", () => {
            expect(
                resolvePipelineName([
                    {
                        binding: "EVENT_STREAM",
                        stream: "current-events",
                        pipeline: "legacy-events",
                    },
                ]),
            ).toBe("current-events");
        });

        it("rejects stale EVENTS_PIPELINE metadata instead of silently using it", () => {
            expect(() =>
                resolvePipelineName([
                    { binding: "EVENTS_PIPELINE", pipeline: "stale" },
                ]),
            ).toThrow(/Stale pipeline binding "EVENTS_PIPELINE"/);
        });

        it("prefers EVENT_STREAM over a stale binding when both are present", () => {
            expect(
                resolvePipelineName([
                    { binding: "EVENTS_PIPELINE", pipeline: "stale" },
                    { binding: "EVENT_STREAM", stream: "noomers-events" },
                ]),
            ).toBe("noomers-events");
        });
    });

    describe("normalizePipelines", () => {
        it("keeps current-format EVENT_STREAM entries unchanged", () => {
            expect(
                normalizePipelines([
                    { binding: "EVENT_STREAM", stream: "noomers-events" },
                ]),
            ).toEqual([{ binding: "EVENT_STREAM", stream: "noomers-events" }]);
        });

        it("migrates a legacy `pipeline` field to `stream`", () => {
            expect(
                normalizePipelines([
                    { binding: "EVENT_STREAM", pipeline: "noomers-events" },
                ]),
            ).toEqual([{ binding: "EVENT_STREAM", stream: "noomers-events" }]);
        });

        it("prefers `stream` when both fields are present", () => {
            expect(
                normalizePipelines([
                    {
                        binding: "EVENT_STREAM",
                        stream: "current-events",
                        pipeline: "legacy-events",
                    },
                ]),
            ).toEqual([{ binding: "EVENT_STREAM", stream: "current-events" }]);
        });

        it("leaves non-canonical bindings untouched", () => {
            expect(
                normalizePipelines([
                    { binding: "EVENTS_PIPELINE", pipeline: "stale" },
                ]),
            ).toEqual([{ binding: "EVENTS_PIPELINE", pipeline: "stale" }]);
        });
    });

    describe("suggestPipelineName", () => {
        it("derives a Pipelines-compatible name from a worker name", () => {
            expect(suggestPipelineName("noomers")).toBe("noomers_events");
        });

        it("replaces hyphens with underscores", () => {
            expect(suggestPipelineName("my-worker")).toBe("my_worker_events");
        });

        it("replaces other non-identifier characters with underscores", () => {
            expect(suggestPipelineName("my.worker")).toBe("my_worker_events");
        });
    });

    describe("resolveDailyRollupsBucket", () => {
        it("derives a bucket from the worker name on a fresh install", async () => {
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(false);

            const result = resolveDailyRollupsBucket("my-worker");

            expect(result).toEqual({
                bucket: "my-worker-daily-rollups",
                previewBucket: "my-worker-daily-rollups-dev",
                preserved: false,
            });
        });

        it("preserves the bucket from persisted deployment metadata", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    version: 1,
                    accountId: "account",
                    workerName: "old-worker",
                    analyticsDataset: "dataset",
                    d1Database: { name: "old-worker-goals", id: "id" },
                    resources: { dailyRollupsBucket: "explicit-bucket" },
                }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "explicit-bucket",
                previewBucket: "explicit-bucket-dev",
                preserved: true,
            });
        });

        it("preserves an explicitly configured bucket from the persisted config", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            // deployment.json does not exist; ~/.noomers/wrangler.json does.
            vi.mocked(existsSync).mockImplementation(
                (p: unknown) => p !== DEPLOYMENT_METADATA_PATH,
            );
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    name: "old-worker",
                    r2_buckets: [
                        {
                            binding: "DAILY_ROLLUPS",
                            bucket_name: "legacy-noomers-bucket",
                        },
                    ],
                }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "legacy-noomers-bucket",
                previewBucket: "legacy-noomers-bucket-dev",
                preserved: true,
            });
        });

        it("preserves an explicitly configured preview bucket name", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockImplementation(
                (p: unknown) => p !== DEPLOYMENT_METADATA_PATH,
            );
            vi.mocked(readFileSync).mockReturnValue(
                JSON.stringify({
                    name: "old-worker",
                    r2_buckets: [
                        {
                            binding: "DAILY_ROLLUPS",
                            bucket_name: "legacy-noomers-bucket",
                            preview_bucket_name: "custom-preview-bucket",
                        },
                    ],
                }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "legacy-noomers-bucket",
                previewBucket: "custom-preview-bucket",
                preserved: true,
            });
        });

        it("derives a fresh bucket when no persisted config or metadata exists", async () => {
            const { existsSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(false);

            const result = resolveDailyRollupsBucket("fresh-worker");

            expect(result.bucket).toBe("fresh-worker-daily-rollups");
            expect(result.previewBucket).toBe("fresh-worker-daily-rollups-dev");
            expect(result.preserved).toBe(false);
        });

        it("prefers an explicit preview persisted in metadata over the config", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "old-worker",
                          analyticsDataset: "dataset",
                          d1Database: { name: "old-worker-goals", id: "id" },
                          resources: {
                              dailyRollupsBucket: "shared-bucket",
                              dailyRollupsPreviewBucket:
                                  "metadata-preview-bucket",
                          },
                      })
                    : JSON.stringify({
                          name: "old-worker",
                          r2_buckets: [
                              {
                                  binding: "DAILY_ROLLUPS",
                                  bucket_name: "shared-bucket",
                                  preview_bucket_name: "config-preview-bucket",
                              },
                          ],
                      }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "shared-bucket",
                previewBucket: "metadata-preview-bucket",
                preserved: true,
            });
        });

        it("falls back to a matching config preview when metadata lacks one", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "old-worker",
                          analyticsDataset: "dataset",
                          d1Database: { name: "old-worker-goals", id: "id" },
                          resources: {
                              dailyRollupsBucket: "shared-bucket",
                          },
                      })
                    : JSON.stringify({
                          name: "old-worker",
                          r2_buckets: [
                              {
                                  binding: "DAILY_ROLLUPS",
                                  bucket_name: "shared-bucket",
                                  preview_bucket_name: "config-preview-bucket",
                              },
                          ],
                      }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "shared-bucket",
                previewBucket: "config-preview-bucket",
                preserved: true,
            });
        });

        it("does not reuse a config preview for a different metadata bucket", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "old-worker",
                          analyticsDataset: "dataset",
                          d1Database: { name: "old-worker-goals", id: "id" },
                          resources: {
                              dailyRollupsBucket: "metadata-bucket",
                          },
                      })
                    : JSON.stringify({
                          name: "old-worker",
                          r2_buckets: [
                              {
                                  binding: "DAILY_ROLLUPS",
                                  bucket_name: "different-bucket",
                                  preview_bucket_name: "config-preview-bucket",
                              },
                          ],
                      }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "metadata-bucket",
                previewBucket: "metadata-bucket-dev",
                preserved: true,
            });
        });

        it("synthesizes the preview when metadata lacks one and config has no explicit preview", async () => {
            const { existsSync, readFileSync } = await import("node:fs");
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation((p: unknown) =>
                p === DEPLOYMENT_METADATA_PATH
                    ? JSON.stringify({
                          version: 1,
                          accountId: "account",
                          workerName: "old-worker",
                          analyticsDataset: "dataset",
                          d1Database: { name: "old-worker-goals", id: "id" },
                          resources: {
                              dailyRollupsBucket: "shared-bucket",
                          },
                      })
                    : JSON.stringify({
                          name: "old-worker",
                          r2_buckets: [
                              {
                                  binding: "DAILY_ROLLUPS",
                                  bucket_name: "shared-bucket",
                              },
                          ],
                      }),
            );

            const result = resolveDailyRollupsBucket("new-worker");

            expect(result).toEqual({
                bucket: "shared-bucket",
                previewBucket: "shared-bucket-dev",
                preserved: true,
            });
        });
    });

    describe("deriveDailyRollupsBucket", () => {
        it("derives a bounded, valid main bucket name", () => {
            const name = deriveDailyRollupsBucket("my-worker", "daily-rollups");
            expect(name).toBe("my-worker-daily-rollups");
            expect(name.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
        });

        it("derives a bounded, valid preview bucket name", () => {
            const name = deriveDailyRollupsBucket(
                "my-worker",
                "daily-rollups-dev",
            );
            expect(name).toBe("my-worker-daily-rollups-dev");
            expect(name.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
        });

        it("binds the length for a maximum-length worker name", () => {
            const longWorker = "a".repeat(100);
            const main = deriveDailyRollupsBucket(longWorker, "daily-rollups");
            const preview = deriveDailyRollupsBucket(
                longWorker,
                "daily-rollups-dev",
            );

            expect(main.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
            expect(preview.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
            expect(main.endsWith("-daily-rollups")).toBe(true);
            expect(preview.endsWith("-daily-rollups-dev")).toBe(true);
        });

        it("normalizes case and strips invalid characters", () => {
            const name = deriveDailyRollupsBucket(
                "My.Worker_Name!",
                "daily-rollups",
            );
            expect(name).toBe("myworkername-daily-rollups");
            expect(/^[a-z0-9-]+$/.test(name)).toBe(true);
        });

        it("does not begin or end with a hyphen", () => {
            const name = deriveDailyRollupsBucket("-worker-", "daily-rollups");
            expect(name.startsWith("-")).toBe(false);
            expect(name.endsWith("-")).toBe(false);
        });

        it("uses a stable default prefix for an empty worker name", () => {
            const name = deriveDailyRollupsBucket("!!!", "daily-rollups");
            expect(name).toBe("noomers-daily-rollups");
        });

        it("never exceeds the 63-character R2 limit for arbitrary worker names", () => {
            const main = deriveDailyRollupsBucket(
                "a-".repeat(40) + "x",
                "daily-rollups",
            );
            expect(main.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
        });

        it("keeps derived names unchanged when no truncation is needed", () => {
            const name = deriveDailyRollupsBucket(
                "worker-that-fits",
                "daily-rollups",
            );
            expect(name).toBe("worker-that-fits-daily-rollups");
        });

        it("produces distinct valid names for long workers sharing a truncated prefix", () => {
            const shared = "a".repeat(40);
            const longA = `${shared}apple`;
            const longB = `${shared}banana`;

            const nameA = deriveDailyRollupsBucket(longA, "daily-rollups");
            const nameB = deriveDailyRollupsBucket(longB, "daily-rollups");

            // Different full names must never collide after truncation.
            expect(nameA).not.toBe(nameB);
            // Both stay within the 63-character R2 limit and preserve the suffix.
            expect(nameA.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
            expect(nameB.length).toBeLessThanOrEqual(R2_BUCKET_MAX_LENGTH);
            expect(nameA.endsWith("-daily-rollups")).toBe(true);
            expect(nameB.endsWith("-daily-rollups")).toBe(true);
            expect(/^[a-z0-9-]+$/.test(nameA)).toBe(true);
            expect(/^[a-z0-9-]+$/.test(nameB)).toBe(true);
        });

        it("is deterministic for the same long worker name", () => {
            const longWorker = "a".repeat(50) + "consistent";
            const first = deriveDailyRollupsBucket(longWorker, "daily-rollups");
            const second = deriveDailyRollupsBucket(
                longWorker,
                "daily-rollups",
            );
            expect(first).toBe(second);
        });
    });
});
