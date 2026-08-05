import { CloudflareClient } from "../lib/cloudflare.js";
import { getDeploymentConfigPath } from "../lib/config.js";
import {
    promptApiToken,
    promptForNewApiToken,
    promptTrackerScriptName,
    getScriptSnippet,
} from "../lib/ui.js";
import { select, isCancel, cancel } from "@clack/prompts";

type SupportedSecret = "CF_BEARER_TOKEN" | "CF_TRACKER_SCRIPT_NAME";

interface SecretConfig {
    /** Primary secret key (single-key secrets). */
    key: SupportedSecret;
    /** Secret keys written by this alias (multi-key aliases). */
    keys?: Array<"STATS_API_TOKEN" | "SITES_API_TOKEN">;
    name: string;
    description: string;
    prompt: () => Promise<string>;
    /** Wording shown when this secret already exists and is being rotated. */
    rotationWarning?: string;
}

export const SECRETS_BY_ALIAS = new Map<string, SecretConfig>([
    [
        "token",
        {
            key: "CF_BEARER_TOKEN",
            name: "Cloudflare API Token",
            description: "Token used to authenticate with Cloudflare API",
            prompt: promptApiToken,
        },
    ],
    [
        "api-token",
        {
            key: "CF_BEARER_TOKEN",
            keys: ["STATS_API_TOKEN", "SITES_API_TOKEN"],
            name: "noomers API Token",
            description:
                "Shared deployment token used to authenticate the Stats API and Sites API. Stored as both STATS_API_TOKEN and SITES_API_TOKEN.",
            prompt: promptForNewApiToken,
            rotationWarning:
                "Rotating this token replaces the existing noomers API token. Enter a strong token of at least 32 characters that you have generated and saved (for example in a password manager). Any client using the previous token (including running dashboard sessions that read it from Worker secrets) will need to switch to the new value. Because the server uses a single shared token, this one value authorizes every registered site in this deployment.",
        },
    ],
    [
        "tracker-script",
        {
            key: "CF_TRACKER_SCRIPT_NAME",
            name: "Tracker Script Name",
            description:
                "Custom name for the tracker.js file served from the server",
            prompt: promptTrackerScriptName,
        },
    ],
]);

export async function envCommand(secretKey?: string) {
    const cloudflare = new CloudflareClient(getDeploymentConfigPath());

    try {
        let selectedSecret: SecretConfig;

        if (secretKey) {
            const matchingSecret = SECRETS_BY_ALIAS.get(secretKey);

            if (!matchingSecret) {
                console.error(`❌ Unknown secret: ${secretKey}`);
                console.log("Supported secrets:");
                SECRETS_BY_ALIAS.forEach((secret, alias) => {
                    console.log(`  - ${secret.name} (alias: ${alias})`);
                });
                process.exit(1);
            }
            selectedSecret = matchingSecret;
        } else {
            const selection = await select({
                message: "Which secret would you like to update?",
                options: Array.from(SECRETS_BY_ALIAS.entries()).map(
                    ([alias, secret]) => ({
                        value: alias,
                        label: `${secret.name} (${alias})`,
                        hint: secret.description,
                    }),
                ),
            });

            if (isCancel(selection)) {
                cancel("Operation canceled.");
                process.exit(0);
            }

            const selectedSecretConfig = SECRETS_BY_ALIAS.get(
                selection as string,
            );
            if (!selectedSecretConfig) {
                throw new Error(
                    `Secret configuration not found for selection: ${selection}`,
                );
            }
            selectedSecret = selectedSecretConfig;
        }

        console.log(`Updating ${selectedSecret.name}...`);

        if (selectedSecret.rotationWarning) {
            console.log(`\n⚠️  ${selectedSecret.rotationWarning}\n`);
        }

        const secretValue = await selectedSecret.prompt();

        const secretMap: Record<string, string> = {};
        if (selectedSecret.keys) {
            for (const key of selectedSecret.keys) {
                secretMap[key] = secretValue;
            }
        } else {
            secretMap[selectedSecret.key] = secretValue;
        }

        const success = await cloudflare.setCloudflareSecrets(secretMap);

        if (success) {
            const writtenKeys = selectedSecret.keys
                ? selectedSecret.keys.join(", ")
                : selectedSecret.key;
            console.log(`✅ ${selectedSecret.name} updated successfully!`);
            console.log(`   Wrote secret(s): ${writtenKeys}`);

            // Show HTML snippet for tracker script configuration
            if (selectedSecret.key === "CF_TRACKER_SCRIPT_NAME") {
                console.log(
                    "\n📝 Use this HTML snippet in your website (replace YOUR_DEPLOY_URL with your actual deployment URL):",
                );
                console.log(getScriptSnippet("YOUR_DEPLOY_URL", secretValue));
            }
        } else {
            console.error(`❌ Failed to update ${selectedSecret.name}`);
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ Error updating secret:", error);
        process.exit(1);
    }
}
