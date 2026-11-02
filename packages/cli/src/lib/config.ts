import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
        dailyRollupsPreviewBucket?: string;
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
 * Resolve the stream identifier from a deployed Wrangler configuration's
 * `pipelines` array, honoring only the canonical `EVENT_STREAM` binding.
 * Accepts both the current `stream` field and the legacy `pipeline` field so
 * persisted configs migrate forward. Returns undefined when no canonical
 * binding is present. Throws when a stale `EVENTS_PIPELINE` binding is the
 * only one present, so the installer surfaces the migration decision instead of
 * silently using stale metadata.
 */
export function resolvePipelineName(
    pipelines:
        | Array<{
              binding?: string;
              pipeline?: string;
              stream?: string;
          }>
        | undefined,
): string | undefined {
    if (!Array.isArray(pipelines) || pipelines.length === 0) {
        return undefined;
    }

    const stream = pipelines.find((p) => p.binding === EVENT_STREAM_BINDING);
    // Prefer the current `stream` field; fall back to the legacy `pipeline`
    // field for backward-compatible migration.
    if (stream?.stream) return stream.stream;
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

/**
 * Derive a Cloudflare Pipelines-compatible name from a worker name. Pipeline
 * names may contain only letters, numbers, and underscores, while worker names
 * may contain hyphens, so any character outside [A-Za-z0-9_] is replaced with
 * an underscore.
 */
export function suggestPipelineName(workerName: string): string {
    return `${workerName.replace(/[^a-zA-Z0-9_]/g, "_")}_events`;
}

/**
 * Normalize a `pipelines` array to the current Cloudflare Pipelines binding
 * contract. Each canonical `EVENT_STREAM` entry keeps its `stream` field when
 * present and migrates a legacy `pipeline` field to `stream`. Non-canonical
 * bindings and unrelated fields are left untouched so validation can still
 * reject stale bindings upstream.
 */
export function normalizePipelines(
    pipelines: Array<{
        binding?: string;
        pipeline?: string;
        stream?: string;
        [key: string]: unknown;
    }>,
): Array<{
    binding?: string;
    stream?: string;
    pipeline?: string;
    [key: string]: unknown;
}> {
    return pipelines.map((entry) => {
        if (entry.binding !== EVENT_STREAM_BINDING) {
            return entry;
        }
        const normalized: {
            binding?: string;
            stream?: string;
            [key: string]: unknown;
        } = { binding: entry.binding };
        if (entry.stream) {
            normalized.stream = entry.stream;
        } else if (entry.pipeline) {
            normalized.stream = entry.pipeline;
        }
        return normalized;
    });
}

/**
 * Read persisted deployment metadata from ~/.noomers/deployment.json. Returns
 * null when no deployment has been persisted yet (fresh install) or when the
 * metadata is unreadable/malformed. A valid persisted deployment is the
 * authoritative record of previously created resources.
 */
export function readPersistedDeploymentMetadata(): DeploymentMetadata | null {
    if (!existsSync(DEPLOYMENT_METADATA_PATH)) return null;
    try {
        const parsed = JSON.parse(
            readFileSync(DEPLOYMENT_METADATA_PATH, "utf8"),
        ) as DeploymentMetadata;
        if (parsed && typeof parsed === "object" && parsed.version === 1) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Deployment-specific fields carried over from a previous install. A
 * reinstall/upgrade must preserve these instead of rebuilding them from the
 * server package defaults and overwriting them: the custom Worker name, the
 * Analytics Engine dataset, the EVENT_STREAM Pipeline binding metadata, and
 * the R2 SQL Worker vars.
 */
export interface PreservedDeploymentConfig {
    workerName: string;
    analyticsDataset: string;
    pipelines?: Array<{
        binding?: string;
        // Legacy field accepted for migration; current-format configs use `stream`.
        pipeline?: string;
        stream?: string;
    }>;
    vars?: Record<string, string>;
}

/**
 * Read the persisted Wrangler config at ~/.noomers/wrangler.json and return
 * the deployment-specific fields that must survive a reinstall/upgrade.
 * Returns null when no config has been persisted yet (fresh install), when the
 * file is unreadable/malformed, or when the worker name or analytics dataset
 * are missing or not non-empty strings, so a partial persisted config can
 * never produce undefined identity values.
 */
export function readPersistedDeploymentConfig(): PreservedDeploymentConfig | null {
    if (!existsSync(DEPLOYMENT_CONFIG_PATH)) return null;

    let parsed: ReturnType<typeof JSON.parse>;
    try {
        parsed = JSON.parse(readFileSync(DEPLOYMENT_CONFIG_PATH, "utf8"));
    } catch {
        return null;
    }

    let workerName: string;
    let analyticsDataset: string;
    try {
        ({ workerName, analyticsDataset } = getWorkerAndDatasetName(parsed));
    } catch {
        return null;
    }
    if (
        typeof workerName !== "string" ||
        workerName.trim() === "" ||
        typeof analyticsDataset !== "string" ||
        analyticsDataset.trim() === ""
    ) {
        return null;
    }

    const metadata = readPersistedDeploymentMetadata();

    // EVENT_STREAM Pipeline binding metadata: prefer the config's `pipelines`
    // array (even an empty one); fall back to the persisted metadata's
    // pipeline name only when the config carries no binding at all. A stale
    // EVENTS_PIPELINE binding is still surfaced for validation rather than
    // silently bypassed by the metadata fallback. Legacy entries that use the
    // `pipeline` field are normalized to the current `stream` field.
    const pipelines = Array.isArray(parsed.pipelines)
        ? normalizePipelines(parsed.pipelines)
        : metadata?.resources?.pipelineName
          ? [
                {
                    binding: EVENT_STREAM_BINDING,
                    stream: metadata.resources.pipelineName,
                },
            ]
          : undefined;

    // R2 SQL Worker vars: prefer explicit config vars; fill in only the
    // missing R2_SQL_BUCKET/R2_SQL_TABLE keys from persisted metadata so an
    // explicitly configured value is never overridden. No other Wrangler
    // fields are reconstructed from metadata.
    const metadataBucket = metadata?.resources?.dataCatalogBucket;
    const metadataTable = metadata?.resources?.dataCatalogTable;
    if (metadataBucket || metadataTable) {
        const merged: Record<string, string> = { ...(parsed.vars ?? {}) };
        if (metadataBucket && merged.R2_SQL_BUCKET === undefined) {
            merged.R2_SQL_BUCKET = metadataBucket;
        }
        if (metadataTable && merged.R2_SQL_TABLE === undefined) {
            merged.R2_SQL_TABLE = metadataTable;
        }
        return {
            workerName,
            analyticsDataset,
            pipelines,
            vars: merged,
        };
    }

    return {
        workerName,
        analyticsDataset,
        pipelines,
        vars: parsed.vars,
    };
}

export interface ResolvedWorkerAndDataset {
    workerName: string;
    analyticsDataset: string;
    /** True when the values came from a persisted deployment, false on a fresh install. */
    preserved: boolean;
}

/**
 * Resolve the worker name and Analytics Engine dataset for an install,
 * preserving any previously persisted deployment configuration.
 *
 * Upgrade safety: never silently migrate an existing deployment back to
 * package defaults. Precedence:
 *   1. Persisted deployment metadata (~/.noomers/deployment.json) is
 *      authoritative.
 *   2. Otherwise the persisted Wrangler config (~/.noomers/wrangler.json) is
 *      used, covering installs persisted before deployment metadata existed.
 *   3. Only a fresh install (neither present) uses the server package
 *      defaults.
 */
export function resolveWorkerAndDataset(
    initialConfig: ReturnType<typeof JSON.parse>,
): ResolvedWorkerAndDataset {
    const metadata = readPersistedDeploymentMetadata();
    if (metadata?.workerName && metadata?.analyticsDataset) {
        return {
            workerName: metadata.workerName,
            analyticsDataset: metadata.analyticsDataset,
            preserved: true,
        };
    }

    const persisted = readPersistedDeploymentConfig();
    if (persisted) {
        return {
            workerName: persisted.workerName,
            analyticsDataset: persisted.analyticsDataset,
            preserved: true,
        };
    }

    const { workerName, analyticsDataset } =
        getWorkerAndDatasetName(initialConfig);
    return { workerName, analyticsDataset, preserved: false };
}

/**
 * Read the DAILY_ROLLUPS bucket binding from a Wrangler configuration object.
 * Locates the binding with find() rather than assuming a positional index, and
 * returns both the main bucket name and (when explicitly configured) the
 * preview bucket name.
 */
function dailyRollupsBucketFromConfig(
    config: ReturnType<typeof JSON.parse>,
): { bucket: string; previewBucket?: string } | undefined {
    const binding = config?.r2_buckets?.find(
        (bucket: { binding?: string }) => bucket.binding === "DAILY_ROLLUPS",
    ) as { bucket_name?: string; preview_bucket_name?: string } | undefined;
    if (!binding?.bucket_name) return undefined;
    return {
        bucket: binding.bucket_name,
        previewBucket: binding.preview_bucket_name,
    };
}

/**
 * R2 bucket naming constraints enforced by Cloudflare. Bucket names may only
 * contain lowercase letters (a-z), numbers (0-9), and hyphens (-); must not
 * begin or end with a hyphen; and must be between 3 and 63 characters.
 */
export const R2_BUCKET_MIN_LENGTH = 3;
export const R2_BUCKET_MAX_LENGTH = 63;

/**
 * Derive a deterministic, bounded R2 bucket name from a worker name and a
 * fixed suffix (e.g. "daily-rollups" or "daily-rollups-dev"). The result is
 * always lowercase, contains only [a-z0-9-], never begins or ends with a
 * hyphen, and is at most 63 characters, so it satisfies Cloudflare's R2 bucket
 * naming constraints even for maximum-length or unusual worker names.
 *
 * The worker-name portion is truncated deterministically when the combined
 * name would exceed the length limit. To preserve deployment isolation when
 * truncation occurs, a short deterministic hash of the full normalized worker
 * name is appended so distinct long names that share a truncated prefix still
 * produce distinct bucket names. When no truncation is needed the name is
 * unchanged (no hash is added), so existing derived names stay stable.
 *
 * If the normalized worker name is empty, a stable default prefix is used.
 * Persisted/explicitly configured bucket names are never passed through this
 * helper.
 */
export function deriveDailyRollupsBucket(
    workerName: string,
    suffix: "daily-rollups" | "daily-rollups-dev",
): string {
    const normalized = workerName.toLowerCase().replace(/[^a-z0-9-]/g, "");
    let base = normalized.replace(/^-+|-+$/g, "");
    if (!base) {
        base = "noomers";
    }

    const separator = "-";
    const maxBase = R2_BUCKET_MAX_LENGTH - separator.length - suffix.length;
    if (base.length <= maxBase) {
        return `${base}${separator}${suffix}`;
    }

    // Truncation is required. Reserve room for a short hash of the full
    // normalized name so distinct long names never collide.
    const hash = shortHash(normalized);
    const hashLen = hash.length;
    const truncateLen = Math.max(
        1,
        R2_BUCKET_MAX_LENGTH - 2 * separator.length - hashLen - suffix.length,
    );
    const truncated = base.slice(0, truncateLen).replace(/-+$/g, "");
    return `${truncated}${separator}${hash}${separator}${suffix}`;
}

/**
 * Return a short, deterministic, lowercase hex digest of the input using only
 * characters valid in an R2 bucket name ([0-9a-f]).
 */
function shortHash(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

/**
 * Resolve the DAILY_ROLLUPS bucket name for this deployment, preserving any
 * previously persisted or explicitly configured bucket.
 *
 * Upgrade safety: never silently migrate an existing deployment to a new
 * bucket. Precedence:
 *   1. Persisted deployment metadata is authoritative for the main bucket.
 *      Its explicit preview bucket is used when present.
 *   2. Otherwise, if the persisted Wrangler config binds the same main bucket
 *      as metadata and explicitly configures a preview bucket, that preview is
 *      preserved (so an explicitly configured preview is never lost when
 *      metadata also exists).
 *   3. Only then is the preview synthesized as `<main>-dev`.
 *
 * Only freshly derived names pass through the bounded derivation helper so they
 * satisfy R2's naming constraints. Persisted/explicit names are never changed.
 */
export function resolveDailyRollupsBucket(workerName: string): {
    bucket: string;
    previewBucket: string;
    preserved: boolean;
} {
    const persisted = readPersistedDeploymentMetadata();
    const configBucket = readPersistedConfigBucket();

    if (persisted?.resources?.dailyRollupsBucket) {
        const main = persisted.resources.dailyRollupsBucket;
        const metadataPreview = persisted.resources.dailyRollupsPreviewBucket;
        if (metadataPreview) {
            return {
                bucket: main,
                previewBucket: metadataPreview,
                preserved: true,
            };
        }
        // Metadata lacks a preview: honor an explicit preview in the persisted
        // config only when it refers to the same main bucket.
        if (configBucket?.bucket === main && configBucket.previewBucket) {
            return {
                bucket: main,
                previewBucket: configBucket.previewBucket,
                preserved: true,
            };
        }
        return {
            bucket: main,
            previewBucket: `${main}-dev`,
            preserved: true,
        };
    }

    if (configBucket) {
        return {
            bucket: configBucket.bucket,
            previewBucket:
                configBucket.previewBucket ?? `${configBucket.bucket}-dev`,
            preserved: true,
        };
    }

    return {
        bucket: deriveDailyRollupsBucket(workerName, "daily-rollups"),
        previewBucket: deriveDailyRollupsBucket(
            workerName,
            "daily-rollups-dev",
        ),
        preserved: false,
    };
}

/**
 * Read the persisted Wrangler config's DAILY_ROLLUPS binding (both main and
 * explicit preview) when present. Returns undefined when the persisted config
 * does not exist, is malformed, or has no DAILY_ROLLUPS binding.
 */
function readPersistedConfigBucket():
    | { bucket: string; previewBucket?: string }
    | undefined {
    if (!existsSync(DEPLOYMENT_CONFIG_PATH)) return undefined;
    try {
        const existing = JSON.parse(
            readFileSync(DEPLOYMENT_CONFIG_PATH, "utf8"),
        );
        return dailyRollupsBucketFromConfig(existing);
    } catch {
        return undefined;
    }
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
        analyticsDataset:
            config.analytics_engine_datasets?.[0]?.dataset ?? "events",
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
    dailyRollups?: { bucket: string; previewBucket: string },
    preservedConfig?: PreservedDeploymentConfig,
): Promise<void> {
    const serverPkgDir = getServerPkgDir();

    const outDeployConfig = makePathsAbsolute(
        initialDeployConfig,
        serverPkgDir,
    );
    outDeployConfig.name = workerName;
    if (outDeployConfig.analytics_engine_datasets?.[0]) {
        outDeployConfig.analytics_engine_datasets[0].dataset = analyticsDataset;
    }

    if (accountId) {
        outDeployConfig.account_id = accountId;
    }

    if (d1Database && outDeployConfig.d1_databases?.[0]) {
        outDeployConfig.d1_databases[0].database_name = d1Database.name;
        outDeployConfig.d1_databases[0].database_id = d1Database.id;
    }

    const dailyRollupsBinding = outDeployConfig.r2_buckets?.find(
        (bucket: { binding?: string }) => bucket.binding === "DAILY_ROLLUPS",
    ) as { bucket_name?: string; preview_bucket_name?: string } | undefined;
    if (dailyRollups && dailyRollupsBinding) {
        dailyRollupsBinding.bucket_name = dailyRollups.bucket;
        dailyRollupsBinding.preview_bucket_name = dailyRollups.previewBucket;
    }

    // Carry over deployment-specific binding metadata and vars from a previous
    // install (the EVENT_STREAM Pipeline binding and the R2 SQL Worker vars)
    // so a reinstall/upgrade does not drop them. The package default config has
    // neither, so only preserved values are ever applied here. Normalize to the
    // current `stream` field so reinstalls write deployable current-format
    // config even when the persisted binding used the legacy `pipeline` field.
    if (preservedConfig?.pipelines) {
        outDeployConfig.pipelines = normalizePipelines(
            preservedConfig.pipelines,
        );
    }

    // Merge preserved vars (R2 SQL configuration is never overwritten).
    if (preservedConfig?.vars) {
        outDeployConfig.vars = { ...preservedConfig.vars };
    }

    writeFileSync(targetPath, JSON.stringify(outDeployConfig, null, 2));
}
