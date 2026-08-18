import { validateDeployment, type ValidateOptions } from "../lib/validate.js";

export interface ValidateCommandOptions {
    url: string;
    site: string;
    skipDurable?: boolean;
    verbose?: boolean;
}

/**
 * Operator-triggered live validation. Read-only: never creates sites, never
 * writes events or resources, and never mutates the deployment. The API token
 * is read only from the NOOMERS_API_TOKEN environment variable; it is never
 * accepted as a CLI option and never printed.
 */
export async function validateCommand(
    opts: ValidateCommandOptions,
): Promise<void> {
    const apiToken = process.env.NOOMERS_API_TOKEN || "";
    if (!apiToken) {
        console.error(
            "❌ NOOMERS_API_TOKEN is not set. Set it in the environment to validate the Sites/Stats API (the token value is never passed as a CLI option or printed).",
        );
        process.exit(1);
    }

    const validateOptions: ValidateOptions = {
        url: opts.url,
        site: opts.site,
        apiToken,
        skipDurable: opts.skipDurable,
    };

    try {
        const result = await validateDeployment(validateOptions);
        for (const check of result.checks) {
            const detail = check.detail ? ` (${check.detail})` : "";
            console.log(`✅ ${check.name}: ok${detail}`);
        }
        const skipped = opts.skipDurable
            ? " Durable (R2 SQL) session check skipped."
            : "";
        console.log(
            `\nValidation passed.${skipped}\n` +
                "Note: this confirms the configured HTTP surface is reachable and the configured " +
                "read queries validate the requested paths. It does not prove durable delivery " +
                "(Analytics Engine, Pipeline/Iceberg, or R2 SQL persistence) now or in the future, " +
                "and no events or resources were written.",
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Validation failed: ${message}`);
        process.exit(1);
    }
}
