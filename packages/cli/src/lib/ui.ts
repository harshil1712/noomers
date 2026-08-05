import figlet from "figlet";
import chalk from "chalk";
import { highlight } from "cli-highlight";
import { password, text, isCancel, cancel, spinner } from "@clack/prompts";
import { CloudflareClient } from "./cloudflare.js";
import { normalizeDomain, normalizeTimezone } from "./validation.js";

export const CLI_COLORS: Record<string, [number, number, number]> = {
    orange: [245, 107, 61],
    tan: [243, 227, 190],
    teal: [0, 205, 205],
};

export const highlightTheme = {
    class: chalk.rgb(...CLI_COLORS.teal),
    literal: chalk.rgb(...CLI_COLORS.teal),
    keyword: chalk.rgb(...CLI_COLORS.orange),
    built_in: chalk.rgb(...CLI_COLORS.orange),
    name: chalk.rgb(...CLI_COLORS.orange),
    string: chalk.rgb(...CLI_COLORS.tan),
    default: chalk.white,
    plain: chalk.white,
};

export function getTitle(noomersVersion: string, homepage: string): string {
    const title = chalk.rgb(...CLI_COLORS.orange)(
        figlet.textSync("noomers", {
            font: "Slant",
        }),
    );

    const subtitle = [
        chalk.rgb(...CLI_COLORS.tan).underline(homepage),
        "•",
        chalk.rgb(...CLI_COLORS.tan)(noomersVersion),
    ].join(" ");

    return `${title}\n${subtitle}`;
}

export const DEFAULT_SITE_ID = "YOUR_UNIQUE_SITE_ID__CHANGE_THIS";

/**
 * Build the HTML tracking snippet. `siteId` defaults to a placeholder for
 * callers that do not yet know the canonical domain; the collector authorizes
 * `sites.domain`, so the snippet's `data-site-id` must be the real domain.
 */
export function getScriptSnippet(
    deployUrl: string,
    scriptName: string = "tracker",
    siteId: string = DEFAULT_SITE_ID,
) {
    return highlight(
        `
<script
    id="noomers-script"
    data-site-id="${siteId}"
    src="${deployUrl}/${scriptName}.js"
    defer
></script>`,
        { language: "html", theme: highlightTheme },
    );
}

export function getPackageSnippet(
    deployUrl: string,
    noomersVersion: string,
    siteId: string = DEFAULT_SITE_ID,
) {
    return highlight(
        `
// $ npm install @noomers/tracker@${noomersVersion}

import * as noomers from "@noomers/tracker";

noomers.init({
    siteId: "${siteId}",
    reporterUrl: "${deployUrl}/collect",
});`,
        { language: "typescript", theme: highlightTheme },
    );
}

export const MIN_PASSWORD_LENGTH = 8;

export async function promptForPassword(
    message: string = "Enter a password for authentication:",
): Promise<string> {
    const userPassword = await password({
        message,
        mask: "*",
        validate: (val) => {
            if (val.length < MIN_PASSWORD_LENGTH) {
                return `A password of ${MIN_PASSWORD_LENGTH} characters or longer is required`;
            }
        },
    });

    if (isCancel(userPassword)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof userPassword !== "string") {
        throw new Error("Password is required");
    }

    return userPassword;
}

export async function promptApiToken(): Promise<string> {
    const cfApiToken = await password({
        message: "Enter your Cloudflare API Token",
        mask: "*",
        validate: (value) => {
            if (typeof value !== "string" || value.length === 0) {
                return "API token is required";
            }

            if (value.length < 40) {
                return "Token appears to be too short";
            }

            return undefined;
        },
    });

    if (isCancel(cfApiToken)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof cfApiToken !== "string" || cfApiToken.length === 0) {
        throw new Error("API token is required");
    }

    const s = spinner();
    s.start("Validating token...");

    try {
        const result = await CloudflareClient.validateToken(cfApiToken);
        s.stop("Token Validated");

        if (!result.valid) {
            throw new Error(
                result.error ||
                    "Invalid token or insufficient permissions. Please verify your token has 'Account Analytics: Read' permission.",
            );
        }
    } catch (error) {
        s.stop();
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(
            "Failed to validate token. Please check your internet connection.",
        );
    }

    return cfApiToken;
}

export async function promptTrackerScriptName(): Promise<string> {
    const scriptName = await text({
        message:
            "Enter the tracker script name (e.g., tracker, analytics, counter, etc):",
        placeholder: "tracker",
        defaultValue: "tracker",
        validate: (value) => {
            if (typeof value !== "string" || value.length === 0) {
                return "Script name is required";
            }

            // Check for invalid filename characters
            const invalidChars = /[<>:"/\\|?*]/;
            if (invalidChars.test(value)) {
                return "Script name contains invalid characters";
            }

            if (value.length > 100) {
                return "Script name is too long (max 100 characters)";
            }

            return undefined;
        },
    });

    if (isCancel(scriptName)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof scriptName !== "string" || scriptName.length === 0) {
        throw new Error("Script name is required");
    }

    return scriptName;
}

export async function promptForDomain(): Promise<string> {
    const domain = await text({
        message:
            "Which domain should the initial analytics site track? " +
            chalk.dim(
                "(lowercase, no spaces/slashes/colons; this becomes the snippet's siteId)",
            ),
        validate: (value) => {
            if (typeof value !== "string" || value.length === 0) {
                return "A domain is required";
            }
            try {
                normalizeDomain(value);
                return undefined;
            } catch (error) {
                return error instanceof Error
                    ? error.message
                    : "Invalid domain";
            }
        },
    });

    if (isCancel(domain)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof domain !== "string" || domain.length === 0) {
        throw new Error("A domain is required");
    }

    return normalizeDomain(domain);
}

export async function promptForTimezone(): Promise<string> {
    const timezone = await text({
        message:
            "Which IANA reporting timezone should this site use? " +
            chalk.dim("[default: Etc/UTC]"),
        initialValue: "Etc/UTC",
        validate: (value) => {
            if (typeof value !== "string" || value.length === 0) {
                return "A timezone is required";
            }
            try {
                normalizeTimezone(value);
                return undefined;
            } catch (error) {
                return error instanceof Error
                    ? error.message
                    : "Invalid timezone";
            }
        },
    });

    if (isCancel(timezone)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof timezone !== "string" || timezone.length === 0) {
        throw new Error("A timezone is required");
    }

    return normalizeTimezone(timezone);
}

/**
 * Securely prompt for the deployment's noomers API token (the shared token
 * stored as STATS_API_TOKEN/SITES_API_TOKEN) without logging or echoing it.
 */
export async function promptForNoomersApiToken(): Promise<string> {
    const token = await password({
        message:
            "Enter the existing noomers API token (used to provision sites):",
        mask: "*",
        validate: (value) => {
            if (typeof value !== "string" || value.length === 0) {
                return "The API token is required";
            }
            return undefined;
        },
    });

    if (isCancel(token)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof token !== "string" || token.length === 0) {
        throw new Error("The API token is required");
    }

    return token;
}

/** Minimum length for a new noomers API token accepted by the installer. */
export const MIN_API_TOKEN_LENGTH = 32;

/**
 * Securely prompt for a strong noomers API token on a fresh install. The token
 * is never auto-generated or logged; the user generates and saves it (for
 * example in a password manager) and enters it here. It is written to both
 * STATS_API_TOKEN and SITES_API_TOKEN. Requires a sensible minimum length but
 * is not validated as a Cloudflare token.
 */
export async function promptForNewApiToken(): Promise<string> {
    const token = await password({
        message:
            "Enter a strong noomers API token you have generated and saved (used to authenticate the Stats API and Sites API):",
        mask: "*",
        validate: (value) => {
            if (
                typeof value !== "string" ||
                value.length < MIN_API_TOKEN_LENGTH
            ) {
                return `The API token must be at least ${MIN_API_TOKEN_LENGTH} characters`;
            }
            return undefined;
        },
    });

    if (isCancel(token)) {
        cancel("Operation canceled.");
        if (process.env.NODE_ENV === "test") {
            throw new Error("Operation canceled");
        }
        process.exit(0);
    }

    if (typeof token !== "string" || token.length < MIN_API_TOKEN_LENGTH) {
        throw new Error(
            `The API token must be at least ${MIN_API_TOKEN_LENGTH} characters`,
        );
    }

    return token;
}
