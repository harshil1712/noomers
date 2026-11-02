import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
    intro,
    text,
    log,
    confirm,
    spinner,
    note,
    isCancel,
    cancel,
    outro,
    select,
} from "@clack/prompts";

import chalk from "chalk";
import type { ArgumentsCamelCase } from "yargs";

import {
    stageDeployConfig,
    readInitialServerConfig,
    persistDeployment,
    resolvePipelineName,
    resolveWorkerAndDataset,
    readPersistedDeploymentConfig,
    suggestPipelineName,
} from "../lib/config.js";

import { CloudflareClient } from "../lib/cloudflare.js";
import {
    getScriptSnippet,
    getPackageSnippet,
    CLI_COLORS,
    promptForPassword,
    promptApiToken,
    promptForDomain,
    promptForTimezone,
    promptForNoomersApiToken,
    promptForNewApiToken,
} from "../lib/ui.js";
import { generateJWTSecret, generatePasswordHash } from "../lib/auth.js";
import {
    discoverHistoricalSites,
    applyBackfill,
    presentBackfill,
    provisionInitialSite,
    provisionSiteIdempotently,
    resolveNoomersApiToken,
} from "../lib/provision.js";
import {
    normalizeDomain,
    normalizeTimezone,
} from "../lib/validation.js";

export function bail() {
    cancel("Operation canceled.");
    if (process.env.NODE_ENV === "test") {
        throw new Error("Operation canceled");
    }
    process.exit(0);
}

export async function promptPasswordProtection(): Promise<boolean> {
    const enableAuth = await confirm({
        message: "Do you want to protect your dashboard with a password?",
        initialValue: true,
    });

    return enableAuth === true;
}

export async function promptDeploy(noomersVersion: string): Promise<boolean> {
    const deploy = await confirm({
        message: `Do you want to deploy version ${noomersVersion} now?`,
        initialValue: false,
    });

    return deploy === true;
}

export interface NewProjectAnswers {
    workerName: string;
    analyticsDataset: string;
}

export interface AccountInfo {
    id: string;
    name: string;
}

export async function promptAccountSelection(
    accounts: AccountInfo[],
): Promise<string> {
    const selectedAccount = await select({
        message: "Select a Cloudflare account:",
        options: accounts.map((account) => ({
            value: account.id,
            label: `${account.name} (${account.id.slice(-6)})`,
        })),
    });

    if (isCancel(selectedAccount)) {
        bail();
    }

    return selectedAccount as string;
}

export async function promptProjectConfig(
    defaultWorkerName?: string,
    defaultAnalyticsDataset?: string,
): Promise<NewProjectAnswers> {
    const workerName = (await text({
        message:
            `What do you want to name your worker? ` +
            chalk.dim(`[default: ${defaultWorkerName}]`),
        initialValue: defaultWorkerName,
    })) as string;

    if (isCancel(workerName)) {
        bail();
    }

    // Analytics Engine was removed; the dataset name is kept only for
    // compatibility with persisted installs and is no longer prompted for.
    return { workerName, analyticsDataset: defaultAnalyticsDataset ?? "events" };
}

const TICK_LENGTH = 500;
async function tick(fn: () => void): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, TICK_LENGTH));
    fn();
}

/**
 * Main CLI install script, takes various user input (e.g. target worker name, Cloudflare API key, etc.)
 * and installs the noomers worker on Cloudflare.
 *
 * @param argv yargs-processed arguments
 * @param serverPkgDir Directory containing the server package
 * @param serverPkgJson Server package.json contents
 */
export async function install(
    argv: ArgumentsCamelCase,
    serverPkgDir: string,
    serverPkgJson: ReturnType<typeof JSON.parse>,
): Promise<void> {
    intro("install");

    // convert argv to opts (Record)
    const opts = argv as Record<string, boolean | unknown>;

    // Create a temporary directory for our config
    const tmpStagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "noomers-"));
    const tmpStagingConfigPath = path.join(tmpStagingDir, "wrangler.json");

    // Ensure we clean up the temporary directory when we're done
    const cleanup = () => {
        try {
            fs.rmSync(tmpStagingDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    const initialDeployConfig = readInitialServerConfig();
    const persistedConfig = readPersistedDeploymentConfig();

    // Validate the effective Pipeline binding metadata before any Cloudflare
    // call or staged deploy so a stale EVENTS_PIPELINE binding aborts the
    // install before deployment.
    const pipelineName = resolvePipelineName(
        persistedConfig?.pipelines ?? initialDeployConfig.pipelines,
    );

    const cloudflare = new CloudflareClient(tmpStagingConfigPath);

    const s = spinner();
    s.start("Fetching Cloudflare accounts ...");
    const accounts = await cloudflare.getAccounts();

    if (accounts.length === 0) {
        s.stop("Not authenticated with Cloudflare.\n");
        log.info(
            `Run ${chalk.red(`npx wrangler login`)} first, then try again.`,
        );
        process.exit(1);
    }

    let accountId: string;

    if (accounts.length === 1) {
        accountId = accounts[0].id;
        s.stop(
            "Authenticated with Cloudflare using Account ID ending in: " +
                chalk.rgb(...CLI_COLORS.teal)(accountId.slice(-6)),
        );
    } else {
        s.stop(`Found ${accounts.length} Cloudflare accounts.`);
        accountId = await promptAccountSelection(accounts);
        log.info(
            "Selected account: " +
                chalk.rgb(...CLI_COLORS.teal)(accountId.slice(-6)),
        );
    }

    if (argv.verbose) {
        await tick(() => {
            log.info(
                "Using server package found in: " +
                    chalk.rgb(...CLI_COLORS.teal)(serverPkgDir),
            );
        });
    }

    if (argv.verbose) {
        await tick(() => {
            log.info(
                "Using staging config in: " +
                    chalk.rgb(...CLI_COLORS.teal)(tmpStagingConfigPath),
            );
        });
    }

    // Resolve the worker name and Analytics Engine dataset, preserving any
    // custom values persisted by a previous install so a reinstall/upgrade
    // never silently falls back to the server package defaults.
    const {
        workerName: defaultWorkerName,
        analyticsDataset: defaultAnalyticsDataset,
    } = resolveWorkerAndDataset(initialDeployConfig);
    let workerName = defaultWorkerName;
    let analyticsDataset = defaultAnalyticsDataset;

    // If --advanced is true, prompt the user for worker name and analytics
    // dataset name. Otherwise, stick to the resolved (persisted or package)
    // values.
    if (opts.advanced) {
        ({ workerName, analyticsDataset } = await promptProjectConfig(
            workerName,
            analyticsDataset,
        ));
    }

    if (opts.verbose) {
        await tick(() => {
            log.info(
                "Using worker name: " +
                    chalk.rgb(...CLI_COLORS.teal)(workerName),
            );
        });
        await tick(() => {
            log.info(
                "Using analytics dataset: " +
                    chalk.rgb(...CLI_COLORS.teal)(analyticsDataset),
            );
        });
    }

    await stageDeployConfig(
        tmpStagingConfigPath,
        initialDeployConfig,
        workerName,
        analyticsDataset,
        accountId,
        undefined,
        undefined,
        persistedConfig ?? undefined,
    );

    // Read current secrets from the deployed worker. This is a read-only
    // listing (no mutation); it determines which secrets must be written once
    // the user confirms deployment.
    const secrets = await cloudflare.getCloudflareSecrets();

    // If the user declines to deploy, abort with zero Cloudflare mutation. All
    // secret writes, resource creation, migrations, and deployments happen only
    // inside the confirmed branch below.
    if (!(await promptDeploy(serverPkgJson.version))) {
        outro(
            "Install canceled. No changes were made to your Cloudflare account.",
        );
        cleanup();
        return;
    }

    // Retain the Cloudflare Account Analytics token in memory so it can be
    // reused for the upgrade backfill below without re-prompting.
    let cfBearerToken: string | undefined;

    // The deployment-wide noomers API token (shared Stats/Sites token). The token
    // is always accepted from the user, never auto-generated. On a fresh install
    // it is written to both secrets; existing installs are never silently
    // rotated and never skip provisioning.
    let noomersApiToken: string | undefined;

    try {
        // Check if CF_BEARER_TOKEN is missing
        if (!secrets?.CF_BEARER_TOKEN) {
            note(
                `Create an API token from your Cloudflare Profile page: ${chalk.bold(
                    "https://dash.cloudflare.com/profile/api-tokens",
                )}

Your token needs these permissions:

- Account Analytics: Read`,
            );
            const apiToken = await promptApiToken();
            if (apiToken) {
                const s = spinner();
                s.start(`Setting Cloudflare API token ...`);

                if (
                    await cloudflare.setCloudflareSecrets({
                        CF_ACCOUNT_ID: accountId,
                        CF_BEARER_TOKEN: apiToken,
                    })
                ) {
                    cfBearerToken = apiToken;
                    s.stop("Setting Cloudflare API token ... Done!");
                } else {
                    s.stop("Error setting Cloudflare API token", 1);
                    throw new Error("Error setting Cloudflare API token");
                }
            }
        }

        // FND-003: resolve the deployment-wide noomers API token. The token is
        // always accepted from the user, never auto-generated or logged. On a
        // fresh install (neither secret present) securely prompt for a strong
        // token and write the same value to both STATS_API_TOKEN and
        // SITES_API_TOKEN. On any existing install (one or both secrets
        // present) securely prompt for the existing token and never write or
        // rotate; if only one secret exists the missing one is not implicitly
        // created.
        const tokenResolution = await resolveNoomersApiToken(secrets, {
            promptNew: promptForNewApiToken,
            promptExisting: promptForNoomersApiToken,
            writeBoth: async (token) =>
                cloudflare.setCloudflareSecrets({
                    STATS_API_TOKEN: token,
                    SITES_API_TOKEN: token,
                }),
        });
        noomersApiToken = tokenResolution.token;
        if (tokenResolution.stored) {
            log.info(
                "Stats/Sites API token configured (stored as STATS_API_TOKEN and SITES_API_TOKEN).",
            );
        }

        if (
            !secrets?.CF_AUTH_ENABLED ||
            !secrets?.CF_PASSWORD_HASH ||
            !secrets?.CF_JWT_SECRET
        ) {
            const enableAuth = await promptPasswordProtection();

            const s = spinner();
            s.start(`Setting noomers Authentication Settings ...`);

            if (enableAuth) {
                // If auth is enabled, prompt for password and set all required secrets
                const appPassword = await promptForPassword(
                    "Enter the password you will use to access the noomers Dashboard",
                );
                if (appPassword) {
                    const jwtSecret = generateJWTSecret();
                    const passwordHash =
                        await generatePasswordHash(appPassword);

                    if (
                        await cloudflare.setCloudflareSecrets({
                            CF_AUTH_ENABLED: "true",
                            CF_PASSWORD_HASH: passwordHash,
                            CF_JWT_SECRET: jwtSecret,
                        })
                    ) {
                        s.stop(
                            "Setting noomers Authentication Settings ... Done!",
                        );
                    } else {
                        s.stop(
                            "Error setting noomers Authentication Settings",
                            1,
                        );
                        throw new Error(
                            "Error setting noomers Authentication Settings",
                        );
                    }
                }
            } else {
                // If auth is disabled, just set CF_AUTH_ENABLED to false
                if (
                    await cloudflare.setCloudflareSecrets({
                        CF_AUTH_ENABLED: "false",
                    })
                ) {
                    s.stop("Setting noomers Authentication Settings ... Done!");
                } else {
                    s.stop("Error setting noomers Authentication Settings", 1);
                    throw new Error(
                        "Error setting noomers Authentication Settings",
                    );
                }
            }
        }

        if (!secrets?.VISITOR_SALT) {
            const s = spinner();
            s.start("Setting visitor attribution secret ...");
            if (
                await cloudflare.setCloudflareSecrets({
                    VISITOR_SALT: generateJWTSecret(),
                })
            ) {
                s.stop("Setting visitor attribution secret ... Done!");
            } else {
                s.stop("Error setting visitor attribution secret", 1);
                throw new Error("Error setting visitor attribution secret");
            }
        }
    } catch (err) {
        console.error(err);
        process.exit(1);
    }

    let deployUrl: string | undefined;
    let siteDomain = opts.domain as string | undefined;
    let siteTimezone = opts.timezone as string | undefined;

    // ---- Interactive input happens before the deploy spinner ----
    // FND-001: accept/prompt for the initial site domain and IANA timezone.
    // Both CLI-provided option values and prompted values are normalized and
    // validated before any backfill or deploy so the canonical domain is used
    // as the siteId everywhere.
    if (siteDomain === undefined || siteTimezone === undefined) {
        siteDomain = siteDomain ?? (await promptForDomain());
        siteTimezone = siteTimezone ?? (await promptForTimezone());
    }
    siteDomain = normalizeDomain(siteDomain);
    siteTimezone = normalizeTimezone(siteTimezone);

    // FND-002: discover and confirm the upgrade backfill before deploying.
    // Uses the retained Cloudflare Account Analytics token (or a securely
    // prompted one on existing installs, since it cannot be read back from
    // wrangler secret list). Backfill is fail-closed: discovery errors, a
    // malformed nonempty ID, an over-bounds result, a declined nonempty
    // plan, or a failed D1 insert all abort the install. Discovered domains
    // are historical candidates; the insert skips already-registered and
    // permanently tombstoned domains.
    let backfillPlan: Awaited<
        ReturnType<typeof discoverHistoricalSites>
    > | null = null;
    {
        const backfillToken = cfBearerToken ?? (await promptApiToken());
        if (backfillToken) {
            backfillPlan = await presentBackfill({
                discover: () =>
                    discoverHistoricalSites(
                        cloudflare,
                        accountId,
                        backfillToken,
                        analyticsDataset,
                        siteTimezone,
                    ),
                confirm: () =>
                    confirm({
                        message:
                            "Insert these historical candidate sites into the D1 registry now?",
                        initialValue: true,
                    }).then((value) => value === true),
                log: (msg) => log.info(msg),
            });
        }
    }

    const deploySpinner = spinner();
    deploySpinner.start(`Deploying noomers ...`);

    try {
        const databaseName = `${workerName}-goals`;
        const databaseId = await cloudflare.getOrCreateD1Database(databaseName);
        await stageDeployConfig(
            tmpStagingConfigPath,
            initialDeployConfig,
            workerName,
            analyticsDataset,
            accountId,
            { name: databaseName, id: databaseId },
            undefined,
            persistedConfig ?? undefined,
        );
        await cloudflare.applyD1Migrations(databaseName);

        // Apply the confirmed backfill now that D1 exists. This is a
        // non-interactive, rerun-safe insert; any failure aborts.
        if (backfillPlan) {
            await applyBackfill(cloudflare, databaseName, backfillPlan);
            log.info("Upgrade backfill applied (rerun-safe).");
        }

        if (opts.verbose) {
            deploySpinner.stop(`Deploying noomers ...`);
        }

        deployUrl = await cloudflare.deploy(
            opts.verbose ? true : false,
            serverPkgJson.version,
        );

        if (deployUrl === "<unknown>") {
            throw new Error(
                "Deployment succeeded but its Workers subdomain could not be determined. Rerun noomers install to provision the initial site.",
            );
        }

        persistDeployment(tmpStagingConfigPath, {
            version: 1,
            accountId,
            workerName,
            analyticsDataset,
            d1Database: { name: databaseName, id: databaseId },
            resources: {
                dailyRollupsBucket: undefined,
                dailyRollupsPreviewBucket: undefined,
                pipelineName,
                dataCatalogBucket:
                    persistedConfig?.vars?.R2_SQL_BUCKET ??
                    initialDeployConfig.vars?.R2_SQL_BUCKET,
                dataCatalogTable:
                    persistedConfig?.vars?.R2_SQL_TABLE ??
                    initialDeployConfig.vars?.R2_SQL_TABLE,
            },
        });

        if (!opts.verbose) {
            // Stop the spinner before the (retry-capable) post-deploy
            // provisioning so its logs and backoff sleeps interleave cleanly.
            deploySpinner.stop("Deploying noomers ... deployed.");
        }

        // FND-001/FND-003: idempotently provision the initial site and
        // verify that the deployment token authenticates against the Sites
        // API. A successful install must not print a real snippet for a
        // site that was never provisioned, so any failure here fails the
        // install clearly (the deploy has happened; instruct rerun).
        if (!noomersApiToken) {
            throw new Error(
                "No deployment API token is available to provision the initial site. Rerun noomers install to remediate.",
            );
        }
        if (!deployUrl) {
            throw new Error(
                "No deployment URL is available to provision the initial site. Rerun noomers install to remediate.",
            );
        }
        const provisionUrl = deployUrl;
        // Provision with bounded retry/backoff to absorb fresh
        // workers.dev propagation and transient network/5xx failures. Each
        // attempt is GET-before-POST (idempotent). Deterministic 4xx/auth
        // failures are not retried.
        await provisionInitialSite({
            provision: () =>
                provisionSiteIdempotently(
                    cloudflare,
                    provisionUrl,
                    noomersApiToken,
                    siteDomain,
                    siteTimezone,
                ),
            verifyAuth: () =>
                cloudflare.verifySitesApiAuth(provisionUrl, noomersApiToken),
            log: (msg) =>
                log.info(
                    `${msg} ${chalk.rgb(...CLI_COLORS.teal).bold(siteDomain)}`,
                ),
        });
        log.info("Deployment complete.");
    } catch (err) {
        deploySpinner.stop("Deploying noomers ... Failed!", 1);
        throw err;
    }

    if (deployUrl) {
        if (
            !(persistedConfig?.pipelines ?? initialDeployConfig.pipelines)
                ?.length
        ) {
            note(
                `Basin Pipelines/Basin Catalog: not provisioned (credentials and interactive setup required).\n\nPreflight: npx wrangler@latest basin pipelines list\nSetup: npx wrangler@latest basin pipelines setup --name ${suggestPipelineName(workerName)}\nSchema: ${path.join(serverPkgDir, "pipelines", "events.schema.json")}\nCatalog status: npx wrangler@latest basin catalog get <BUCKET>`,
                "Optional convergence storage",
            );
        }

        await tick(() =>
            note(
                "NOTE: If this is your first time deploying to this subdomain, you may have to wait a few minutes before the site is live.",
            ),
        );

        await tick(() =>
            outro(
                `⚡️ Visit your dashboard: ${chalk
                    .rgb(...CLI_COLORS.tan)
                    .underline(deployUrl)}`,
            ),
        );

        const siteId = siteDomain;
        await tick(() =>
            console.log(
                `\nTo start capturing data for ${chalk
                    .rgb(...CLI_COLORS.teal)
                    .bold(siteId)}, add the tracking script to your website: `,
            ),
        );
        await tick(() => {
            console.log(getScriptSnippet(deployUrl, "tracker", siteId));
            console.log("\n\n" + chalk.dim("-- OR --") + "\n");
            console.log(
                getPackageSnippet(deployUrl, serverPkgJson.version, siteId),
            );
        });
    }
}
