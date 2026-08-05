import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

export const NOOMERS_DIR = path.join(homedir(), ".noomers");
export const DEPLOYMENT_CONFIG_PATH = path.join(NOOMERS_DIR, "wrangler.json");
export const DEPLOYMENT_METADATA_PATH = path.join(
    NOOMERS_DIR,
    "deployment.json",
);

export interface DeploymentMetadata {
    version: 1;
    accountId: string;
    workerName: string;
    analyticsDataset: string;
    d1Database: { name: string; id: string };
    resources: {
        dailyRollupsBucket?: string;
        pipelineName?: string;
        dataCatalogBucket?: string;
        dataCatalogTable?: string;
    };
}

/**
 * The canonical runtime Pipeline binding name. The server writes durable
 * events through `EVENT_STREAM`; metadata must use this name consistently and
 * must never fall back to the legacy `EVENTS_PIPELINE` binding.
 */
export const EVENT_STREAM_BINDING = "EVENT_STREAM";

/**
 * Legacy binding names that must not be honored. Callers should reject or
 * migrate them rather than silently reading a stale pipeline name.
 */
export const LEGACY_PIPELINE_BINDINGS = ["EVENTS_PIPELINE"];

/**
 * Resolve the pipeline name from a deployed Wrangler configuration's
 * `pipelines` array, honoring only the canonical `EVENT_STREAM` binding.
 * Returns undefined when no canonical binding is present. Throws when a stale
 * `EVENTS_PIPELINE` binding is the only one present, so the installer surfaces
 * the migration decision instead of silently using stale metadata.
 */
export function resolvePipelineName(
    pipelines: Array<{ binding?: string; pipeline?: string }> | undefined,
): string | undefined {
    if (!Array.isArray(pipelines) || pipelines.length === 0) {
        return undefined;
    }

    const stream = pipelines.find((p) => p.binding === EVENT_STREAM_BINDING);
    if (stream?.pipeline) return stream.pipeline;

    const stale = pipelines.find((p) =>
        LEGACY_PIPELINE_BINDINGS.includes(p.binding ?? ""),
    );
    if (stale) {
        throw new Error(
            `Stale pipeline binding "${stale.binding}" found. Rename it to "${EVENT_STREAM_BINDING}" so metadata matches the runtime binding.`,
        );
    }

    return undefined;
}

export function getDeploymentConfigPath(): string {
    if (!existsSync(DEPLOYMENT_CONFIG_PATH)) {
        throw new Error(
            `No installed deployment found at ${DEPLOYMENT_CONFIG_PATH}. Run noomers install first.`,
        );
    }
    return DEPLOYMENT_CONFIG_PATH;
}

export function persistDeployment(
    stagedConfigPath: string,
    metadata: DeploymentMetadata,
): void {
    mkdirSync(NOOMERS_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(
        DEPLOYMENT_CONFIG_PATH,
        readFileSync(stagedConfigPath, "utf8"),
        { mode: 0o600 },
    );
    writeFileSync(DEPLOYMENT_METADATA_PATH, JSON.stringify(metadata, null, 2), {
        mode: 0o600,
    });
}

const __filename = fileURLToPath(import.meta.url);

/**
 * Finds the directory of the @noomers/server package.
 * @returns The path to the @noomers/server package directory.
 */
export function getServerPkgDir(): string {
    const __dirname = dirname(__filename);

    // 1) first check root project directory (e.g. if this is a monorepo checkout)
    const monoRepoPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "packages",
        "server",
    );

    if (existsSync(monoRepoPath)) {
        return monoRepoPath;
    }

    // 2) next check common node_modules directory (if this is npm installed)
    const nodeModulesDir = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "@noomers",
        "server",
    );
    if (existsSync(nodeModulesDir)) {
        return nodeModulesDir;
    }

    throw new Error("Could not find @noomers/server package. Is it installed?");
}

// Recursively convert all relative paths to absolute
export const makePathsAbsolute = (
    obj: ReturnType<typeof JSON.parse>,
    fullDir: string,
): ReturnType<typeof JSON.parse> => {
    if (!obj || typeof obj !== "object") return obj;

    // Handle arrays directly
    if (Array.isArray(obj)) {
        return obj.map((item) => {
            if (
                typeof item === "string" &&
                item.includes("/") &&
                !path.isAbsolute(item)
            ) {
                return path.join(fullDir, item);
            }
            return makePathsAbsolute(item, fullDir);
        });
    }

    const result: ReturnType<typeof JSON.parse> = {};

    for (const [key, value] of Object.entries(obj)) {
        if (
            typeof value === "string" &&
            value.includes("/") &&
            !path.isAbsolute(value)
        ) {
            result[key] = path.join(fullDir, value);
        } else if (Array.isArray(value)) {
            result[key] = value.map((item) => {
                if (
                    typeof item === "string" &&
                    item.includes("/") &&
                    !path.isAbsolute(item)
                ) {
                    return path.join(fullDir, item);
                }
                return makePathsAbsolute(item, fullDir);
            });
        } else if (typeof value === "object") {
            result[key] = makePathsAbsolute(value, fullDir);
        } else {
            result[key] = value;
        }
    }

    return result;
};

export function getWorkerAndDatasetName(config: ReturnType<typeof JSON.parse>) {
    return {
        workerName: config.name as string,
        analyticsDataset: config.analytics_engine_datasets[0].dataset,
    };
}

/**
 * Reads the initial server config from the @noomers/server package
 */
export function readInitialServerConfig() {
    const serverPkgDir = getServerPkgDir();
    const distConfig = JSON.parse(
        readFileSync(path.join(serverPkgDir, "wrangler.json"), "utf8"),
    );

    return distConfig;
}

/**
 * Writes a local copy of wrangler.json (in ~/.noomers) where all the paths are
 * converted to be absolute. This makes it so that the `wrangler deploy` command can be
 * run from any directory.
 */
export async function stageDeployConfig(
    targetPath: string,
    initialDeployConfig: ReturnType<typeof JSON.parse>,
    workerName: string,
    analyticsDataset: string,
    accountId?: string,
    d1Database?: { name: string; id: string },
): Promise<void> {
    const serverPkgDir = getServerPkgDir();

    const outDeployConfig = makePathsAbsolute(
        initialDeployConfig,
        serverPkgDir,
    );
    outDeployConfig.name = workerName;
    outDeployConfig.analytics_engine_datasets[0].dataset = analyticsDataset;

    if (accountId) {
        outDeployConfig.account_id = accountId;
    }

    if (d1Database && outDeployConfig.d1_databases?.[0]) {
        outDeployConfig.d1_databases[0].database_name = d1Database.name;
        outDeployConfig.d1_databases[0].database_id = d1Database.id;
    }

    writeFileSync(targetPath, JSON.stringify(outDeployConfig, null, 2));
}
