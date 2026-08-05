import { $, ProcessOutput } from "zx";
import path from "path";
import { homedir } from "node:os";
import type { AnalyticsEngineQueryResponse } from "./backfill.js";

interface SecretItem {
    name: string;
    type: string;
}

interface AccountInfo {
    id: string;
    name: string;
}

interface TokenValidationResponse {
    success: boolean;
    result?: {
        id: string;
        status: string;
    };
    errors?: Array<{ code: number; message: string }>;
}

interface D1DatabaseInfo {
    uuid: string;
    name: string;
}

export class CloudflareClient {
    private configPath: string;

    constructor(configPath?: string) {
        this.configPath =
            configPath || path.join(homedir(), ".noomers", "wrangler.json");
    }

    async getAccountId(): Promise<string | null> {
        try {
            const result = await $({ quiet: true })`npx wrangler whoami`;
            const match = result.stdout.match(/([0-9a-f]{32})/);
            return match ? match[0] : null;
        } catch (error) {
            if (error instanceof ProcessOutput) {
                throw new Error(error.stderr || error.stdout);
            }
            throw error;
        }
    }

    async getAccounts(): Promise<AccountInfo[]> {
        try {
            const result = await $({ quiet: true })`npx wrangler whoami`;
            const accounts = this.parseAccountsFromTable(result.stdout);

            // If table parsing failed, fall back to single account
            if (accounts.length === 0) {
                const accountId = await this.getAccountId();
                if (accountId) {
                    return [
                        {
                            id: accountId,
                            name: `Account ${accountId.slice(-6)}`,
                        },
                    ];
                }
            }

            return accounts;
        } catch (error) {
            if (error instanceof ProcessOutput) {
                throw new Error(error.stderr || error.stdout);
            }
            throw error;
        }
    }

    private parseAccountsFromTable(output: string): AccountInfo[] {
        const accounts: AccountInfo[] = [];
        const lines = output.split("\n");

        for (const line of lines) {
            // Skip header and separator lines
            if (
                !line.includes("│") ||
                line.includes("Account Name") ||
                line.includes("─")
            ) {
                continue;
            }

            const parts = line
                .split("│")
                .map((part) => part.trim())
                .filter(Boolean);

            if (parts.length >= 2) {
                const [name, id] = parts;

                // Validate account ID format (32 hex characters)
                if (/^[0-9a-f]{32}$/.test(id)) {
                    accounts.push({ id, name });
                }
            }
        }

        return accounts;
    }

    private async fetchCloudflareSecrets(): Promise<string> {
        try {
            const result =
                await $`npx wrangler secret list --config ${this.configPath}`;
            return result.stdout;
        } catch (error) {
            throw error instanceof ProcessOutput
                ? error.stdout || error.stderr
                : error;
        }
    }

    static async validateToken(
        token: string,
    ): Promise<{ valid: boolean; error?: string }> {
        try {
            const response = await fetch(
                "https://api.cloudflare.com/client/v4/user/tokens/verify",
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                },
            );

            if (!response.ok) {
                if (response.status === 401) {
                    return { valid: false, error: "Invalid or expired token" };
                }
                if (response.status === 403) {
                    return {
                        valid: false,
                        error: "Token lacks required permissions",
                    };
                }
                return {
                    valid: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                };
            }

            const data: TokenValidationResponse = await response.json();

            if (!data.success) {
                const errorMessage =
                    data.errors?.[0]?.message || "Token validation failed";
                return { valid: false, error: errorMessage };
            }

            if (data.result?.status !== "active") {
                return { valid: false, error: "Token is not active" };
            }

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Network error during validation",
            };
        }
    }

    async getCloudflareSecrets(): Promise<Record<string, string>> {
        let rawSecrets: string;
        try {
            rawSecrets = await this.fetchCloudflareSecrets();
        } catch (err) {
            // worker not created yet
            if (
                typeof err === "string" &&
                err.indexOf("[code: 10007]") !== -1
            ) {
                return {};
            }
            throw err;
        }

        const secretsList = JSON.parse(rawSecrets) as SecretItem[];
        const secrets: Record<string, string> = {};
        secretsList.forEach((secret: SecretItem) => {
            secrets[secret.name] = secret.type;
        });
        return secrets;
    }

    async setCloudflareSecrets(
        secrets: Record<string, string>,
    ): Promise<boolean> {
        for (const [key, value] of Object.entries(secrets)) {
            try {
                await $({
                    input: `${value}\n`,
                    quiet: true,
                })`npx wrangler secret put ${key} --config ${this.configPath}`;
            } catch {
                return false;
            }
        }
        return true;
    }

    async getOrCreateR2Bucket(name: string): Promise<"existing" | "created"> {
        const listResult =
            await $`npx wrangler r2 bucket list --config ${this.configPath}`;
        if (this.r2BucketListContains(listResult.stdout, name)) {
            return "existing";
        }

        try {
            await $`npx wrangler r2 bucket create ${name} --config ${this.configPath}`;
            return "created";
        } catch (error) {
            const retryList =
                await $`npx wrangler r2 bucket list --config ${this.configPath}`;
            if (this.r2BucketListContains(retryList.stdout, name)) {
                return "existing";
            }
            throw error;
        }
    }

    private r2BucketListContains(output: string, name: string): boolean {
        try {
            const buckets = JSON.parse(output) as Array<{
                name?: string;
                bucket_name?: string;
            }>;
            if (
                buckets.some(
                    (bucket) =>
                        bucket.name === name || bucket.bucket_name === name,
                )
            ) {
                return true;
            }
        } catch {
            // Older Wrangler versions render this command as a table.
        }

        return output.split("\n").some((line) =>
            line
                .split(/[│|\s]+/)
                .map((value) => value.trim())
                .includes(name),
        );
    }

    async getOrCreateD1Database(name: string): Promise<string> {
        const listResult =
            await $`npx wrangler d1 list --json --config ${this.configPath}`;
        const databases = JSON.parse(listResult.stdout) as D1DatabaseInfo[];
        const existing = databases.find((database) => database.name === name);
        if (existing) return existing.uuid;

        const createResult =
            await $`npx wrangler d1 create ${name} --config ${this.configPath}`;
        const id = createResult.stdout.match(
            /["']?database_id["']?\s*[:=]\s*["']([0-9a-f-]{36})["']/i,
        )?.[1];
        if (!id)
            throw new Error(`Could not determine D1 database ID for ${name}`);
        return id;
    }

    async applyD1Migrations(databaseName: string): Promise<void> {
        await $`npx wrangler d1 migrations apply ${databaseName} --remote --config ${this.configPath}`;
    }

    async deploy(verbose: boolean, version: string): Promise<string> {
        try {
            const p = $({
                quiet: true,
            })`npx wrangler deploy --config ${this.configPath} --var VERSION:${version}`;

            let output = "";
            for await (const text of p) {
                output += text;
                if (verbose) {
                    console.log(text);
                }
            }

            const match = output.match(
                /([a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)/i,
            );
            return match ? "https://" + match[0] : "<unknown>";
        } catch (error) {
            if (error instanceof ProcessOutput) {
                throw new Error(error.stderr || error.stdout);
            }
            throw error;
        }
    }

    /**
     * Execute a SQL statement against the deployed D1 database. Used for the
     * rerun-safe backfill insert before fail-closed collection is live.
     */
    async executeD1Statement(databaseName: string, sql: string): Promise<void> {
        try {
            await $({
                quiet: true,
            })`npx wrangler d1 execute ${databaseName} --remote --command ${sql} --config ${this.configPath}`;
        } catch (error) {
            if (error instanceof ProcessOutput) {
                throw new Error(error.stderr || error.stdout);
            }
            throw error;
        }
    }

    /**
     * Query the Cloudflare Analytics Engine SQL API for distinct historical
     * site IDs. Uses the existing Cloudflare Account Analytics token. The
     * query must already be bounded and validated (see backfill.ts).
     */
    async queryAnalyticsEngine(
        accountId: string,
        apiToken: string,
        sql: string,
    ): Promise<AnalyticsEngineQueryResponse> {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    "Content-Type": "application/json",
                },
                body: sql,
            },
        );

        if (!response.ok) {
            throw new Error(
                `Analytics Engine query failed (HTTP ${response.status}): ${response.statusText}`,
            );
        }

        return (await response.json()) as AnalyticsEngineQueryResponse;
    }

    /**
     * Fetch a site from the deployed Sites API by domain. Returns the site
     * object when found, null when the site does not exist, and throws on
     * authentication or API errors so callers can distinguish "not found"
     * from "cannot verify".
     */
    async getSiteByDomain(
        deployUrl: string,
        apiToken: string,
        domain: string,
    ): Promise<Record<string, unknown> | null> {
        const response = await fetch(
            `${deployUrl}/api/v1/sites/${encodeURIComponent(domain)}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    "Content-Type": "application/json",
                },
            },
        );

        if (response.status === 404) return null;

        if (!response.ok) {
            throw new Error(
                `Sites API GET failed (HTTP ${response.status}): ${response.statusText}`,
            );
        }

        return (await response.json()) as Record<string, unknown>;
    }

    /**
     * Create a site through the deployed Sites API. Throws on authentication
     * or API errors so callers never mistake a failure for success.
     */
    async createSite(
        deployUrl: string,
        apiToken: string,
        domain: string,
        timezone: string,
    ): Promise<Record<string, unknown>> {
        const response = await fetch(`${deployUrl}/api/v1/sites`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ domain, timezone }),
        });

        if (!response.ok) {
            throw new Error(
                `Sites API POST failed (HTTP ${response.status}): ${response.statusText}`,
            );
        }

        return (await response.json()) as Record<string, unknown>;
    }

    /**
     * Verify that the deployment-wide API token authenticates against the
     * Sites API by issuing a list request. Returns true when authenticated.
     */
    async verifySitesApiAuth(
        deployUrl: string,
        apiToken: string,
    ): Promise<boolean> {
        const response = await fetch(`${deployUrl}/api/v1/sites`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
        });

        if (response.status === 401 || response.status === 403) return false;
        return response.ok;
    }
}
