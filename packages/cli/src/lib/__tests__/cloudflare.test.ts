import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareClient } from "../cloudflare.js";
import { ProcessOutput } from "zx";
import path from "path";
import { homedir } from "node:os";

// Mock the entire zx module
vi.mock("zx", async (importOriginal) => {
    const actual = await importOriginal<typeof import("zx")>();
    return {
        ...actual,
        $: vi.fn(),
    };
});

// Import and spy on the mocked function
const { $ } = await import("zx");

// Mock fetch globally
global.fetch = vi.fn();

describe("CloudflareClient", () => {
    let client: CloudflareClient;
    const mockConfigPath = "/mock/path/wrangler.json";

    beforeEach(() => {
        vi.clearAllMocks();
        client = new CloudflareClient(mockConfigPath);
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe("constructor", () => {
        it("should use default config path when not provided", () => {
            const defaultClient = new CloudflareClient();
            expect(defaultClient["configPath"]).toBe(
                path.join(homedir(), ".noomers", "wrangler.json"),
            );
        });

        it("should use provided config path", () => {
            expect(client["configPath"]).toBe(mockConfigPath);
        });
    });

    describe("getAccountId", () => {
        it("should extract account ID from whoami command", async () => {
            const mockAccountId = "1234567890abcdef1234567890abcdef";

            vi.mocked($).mockImplementation(() => {
                return () => ({
                    stdout: `random content ${mockAccountId} \nmore random content`,
                    stderr: "",
                    exitCode: 0,
                });
            });

            const result = await client.getAccountId();
            expect(result).toBe(mockAccountId);
            expect($).toHaveBeenCalledWith({ quiet: true });
        });

        it("should return null if account ID not found", async () => {
            vi.mocked($).mockImplementation(() => {
                return () => ({
                    stdout: "No account ID here",
                    stderr: "",
                    exitCode: 0,
                });
            });

            const result = await client.getAccountId();
            expect(result).toBeNull();
        });

        it("should handle command errors", async () => {
            vi.mocked($).mockImplementation(() => {
                return () => {
                    throw new ProcessOutput(
                        1, // exit code
                        null, // signal
                        "Command failed", // stdout
                        "", // stderr
                        "Command failed", // combined?
                        "",
                        0, // duration
                    );
                };
            });

            await expect(client.getAccountId()).rejects.toThrow(
                "Command failed",
            );
        });
    });

    describe("getCloudflareSecrets", () => {
        it("should parse secrets list correctly", async () => {
            const mockSecrets = [
                { name: "SECRET1", type: "string" },
                { name: "SECRET2", type: "string" },
            ];

            vi.mocked($).mockImplementation(() => {
                return {
                    stdout: JSON.stringify(mockSecrets),
                    stderr: "",
                    exitCode: 0,
                };
            });

            const result = await client.getCloudflareSecrets();
            expect(result).toEqual({
                SECRET1: "string",
                SECRET2: "string",
            });
        });

        it("should return empty object when worker not created", async () => {
            vi.mocked($).mockImplementation(() => {
                throw "other content \n[code: 10007] Worker not found";
            });

            const result = await client.getCloudflareSecrets();
            expect(result).toEqual({});
        });

        it("should throw on other errors", async () => {
            vi.mocked($).mockImplementation(() => {
                throw "Unknown error";
            });

            await expect(client.getCloudflareSecrets()).rejects.toThrow();
        });
    });

    describe("setCloudflareSecrets", () => {
        it("should set all secrets successfully", async () => {
            vi.mocked($).mockImplementation((options: any) => {
                expect(options.input).toMatch(/^value[12]\n$/);
                return () => ({
                    stdout: "Secret successfully created/updated",
                    stderr: "",
                    exitCode: 0,
                });
            });

            const result = await client.setCloudflareSecrets({
                SECRET1: "value1",
                SECRET2: "value2",
            });
            expect(result).toBe(true);
            expect($).toHaveBeenCalledTimes(2);
            expect($).toHaveBeenCalledWith({
                input: "value1\n",
                quiet: true,
            });
        });

        it("should return false if any secret fails to set", async () => {
            let callCount = 0;

            vi.mocked($).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return () => ({
                        stdout: "Success",
                        stderr: "",
                        exitCode: 0,
                    });
                } else {
                    return () => {
                        throw new Error("Failed to set secret");
                    };
                }
            });

            const result = await client.setCloudflareSecrets({
                SECRET1: "value1",
                SECRET2: "value2",
            });
            expect(result).toBe(false);
        });
    });

    describe("R2", () => {
        it("reuses an existing daily bucket from JSON output", async () => {
            vi.mocked($).mockReturnValueOnce({
                stdout: JSON.stringify([
                    { name: "noomers-daily-rollups" },
                ]),
            } as any);

            await expect(
                client.getOrCreateR2Bucket("noomers-daily-rollups"),
            ).resolves.toBe("existing");
            expect($).toHaveBeenCalledTimes(1);
        });

        it("reuses an existing daily bucket from table output", async () => {
            vi.mocked($).mockReturnValueOnce({
                stdout: "│ noomers-daily-rollups │ 2026-01-01 │",
            } as any);

            await expect(
                client.getOrCreateR2Bucket("noomers-daily-rollups"),
            ).resolves.toBe("existing");
            expect($).toHaveBeenCalledTimes(1);
        });

        it("creates a missing daily bucket", async () => {
            vi.mocked($)
                .mockReturnValueOnce({ stdout: "[]" } as any)
                .mockReturnValueOnce({ stdout: "Created" } as any);

            await expect(
                client.getOrCreateR2Bucket("noomers-daily-rollups"),
            ).resolves.toBe("created");
            expect($).toHaveBeenCalledTimes(2);
        });

        it("does not create a bucket when listing fails", async () => {
            vi.mocked($).mockRejectedValueOnce(new Error("Not authenticated"));

            await expect(
                client.getOrCreateR2Bucket("noomers-daily-rollups"),
            ).rejects.toThrow("Not authenticated");
            expect($).toHaveBeenCalledTimes(1);
        });

        it("handles another installer creating the bucket concurrently", async () => {
            vi.mocked($)
                .mockReturnValueOnce({ stdout: "[]" } as any)
                .mockRejectedValueOnce(new Error("Bucket already exists"))
                .mockReturnValueOnce({
                    stdout: JSON.stringify([
                        { name: "noomers-daily-rollups" },
                    ]),
                } as any);

            await expect(
                client.getOrCreateR2Bucket("noomers-daily-rollups"),
            ).resolves.toBe("existing");
            expect($).toHaveBeenCalledTimes(3);
        });
    });

    describe("getAccounts", () => {
        it("should parse multiple accounts from table format", async () => {
            const mockOutput = `
Getting User settings...
ℹ️  The API Token is read from the CLOUDFLARE_API_TOKEN in your environment.
👋 You are logged in with an API Token. Unable to retrieve email for this user. Are you missing the User->User Details->Read permission?
┌─────────────┬──────────────────────────────────┐
│ Account Name│ Account ID                       │
├─────────────┼──────────────────────────────────┤
│ Account 1   │ 1234567890abcdef1234567890abcdef │
│ Account 2   │ abcdef1234567890abcdef1234567890 │
└─────────────┴──────────────────────────────────┘
`;

            vi.mocked($).mockImplementation(() => {
                return () => ({
                    stdout: mockOutput,
                    stderr: "",
                    exitCode: 0,
                });
            });

            const result = await client.getAccounts();
            expect(result).toEqual([
                { id: "1234567890abcdef1234567890abcdef", name: "Account 1" },
                { id: "abcdef1234567890abcdef1234567890", name: "Account 2" },
            ]);
        });

        it("should parse single account from table format", async () => {
            const mockOutput = `
Getting User settings...
ℹ️  The API Token is read from the CLOUDFLARE_API_TOKEN in your environment.
👋 You are logged in with an API Token. Unable to retrieve email for this user. Are you missing the User->User Details->Read permission?
┌─────────────┬──────────────────────────────────┐
│ Account Name│ Account ID                       │
├─────────────┼──────────────────────────────────┤
│ Account 1   │ 1234567890abcdef1234567890abcdef │
└─────────────┴──────────────────────────────────┘
`;

            vi.mocked($).mockImplementation(() => {
                return () => ({
                    stdout: mockOutput,
                    stderr: "",
                    exitCode: 0,
                });
            });

            const result = await client.getAccounts();
            expect(result).toEqual([
                { id: "1234567890abcdef1234567890abcdef", name: "Account 1" },
            ]);
        });

        it("should fall back to getAccountId when table parsing fails", async () => {
            const mockOutput = "Invalid output format";
            const mockAccountId = "1234567890abcdef1234567890abcdef";

            vi.mocked($).mockImplementation(() => {
                return () => ({
                    stdout: mockOutput,
                    stderr: "",
                    exitCode: 0,
                });
            });

            // Mock getAccountId to return a fallback account
            vi.spyOn(client, "getAccountId").mockResolvedValue(mockAccountId);

            const result = await client.getAccounts();
            expect(result).toEqual([
                {
                    id: mockAccountId,
                    name: `Account ${mockAccountId.slice(-6)}`,
                },
            ]);
        });

        it("should return empty array when no accounts found", async () => {
            const mockOutput = "No accounts found";

            vi.mocked($).mockImplementation(() => {
                return () => ({
                    stdout: mockOutput,
                    stderr: "",
                    exitCode: 0,
                });
            });

            // Mock getAccountId to return null
            vi.spyOn(client, "getAccountId").mockResolvedValue(null);

            const result = await client.getAccounts();
            expect(result).toEqual([]);
        });

        it("should handle command errors", async () => {
            vi.mocked($).mockImplementation(() => {
                return () => {
                    throw new ProcessOutput(
                        1, // exit code
                        null, // signal
                        "Command failed", // stdout
                        "", // stderr
                        "Command failed", // combined?
                        "",
                        0, // duration
                    );
                };
            });

            await expect(client.getAccounts()).rejects.toThrow(
                "Command failed",
            );
        });
    });

    describe("D1", () => {
        it("reuses an existing goals database", async () => {
            vi.mocked($).mockImplementation(() => ({
                stdout: JSON.stringify([
                    {
                        uuid: "11111111-1111-1111-1111-111111111111",
                        name: "goals",
                    },
                ]),
                stderr: "",
                exitCode: 0,
            }));

            await expect(client.getOrCreateD1Database("goals")).resolves.toBe(
                "11111111-1111-1111-1111-111111111111",
            );
            expect($).toHaveBeenCalledTimes(1);
        });

        it("creates a missing database and applies migrations", async () => {
            let call = 0;
            vi.mocked($).mockImplementation(() => {
                call += 1;
                if (call === 1) {
                    return { stdout: "[]", stderr: "", exitCode: 0 };
                }
                if (call === 2) {
                    return {
                        stdout: `{
                            "database_name": "goals",
                            "database_id": "22222222-2222-2222-2222-222222222222"
                        }`,
                        stderr: "",
                        exitCode: 0,
                    };
                }
                return { stdout: "Applied", stderr: "", exitCode: 0 };
            });

            const id = await client.getOrCreateD1Database("goals");
            await client.applyD1Migrations("goals");

            expect(id).toBe("22222222-2222-2222-2222-222222222222");
            expect($).toHaveBeenCalledTimes(3);
        });
    });

    describe("deploy", () => {
        it("should extract worker URL from deploy output", async () => {
            vi.mocked($).mockImplementation(() => {
                return async function* () {
                    yield "Worker deployed to test-worker.test-account.workers.dev";
                };
            });

            const result = await client.deploy(false, "0.0.1");
            expect(result).toBe("https://test-worker.test-account.workers.dev");
        });

        it("should return <unknown> if URL not found in output", async () => {
            vi.mocked($).mockImplementation(() => {
                return async function* () {
                    yield "Deployment successful but no URL found";
                };
            });

            const result = await client.deploy(false, "0.0.1");
            expect(result).toBe("<unknown>");
        });

        it("should throw on deployment error", async () => {
            vi.mocked($).mockImplementation(() => {
                throw new Error("Deployment failed");
            });

            await expect(client.deploy(false, "0.0.1")).rejects.toThrow(
                "Deployment failed",
            );
        });
    });
});

describe("CloudflareClient.validateToken", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("should return valid: true for active token", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: true,
                result: { id: "test-id", status: "active" },
            }),
        });

        const result = await CloudflareClient.validateToken("valid-token");
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it("should return valid: false for 401 unauthorized", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
        });

        const result = await CloudflareClient.validateToken("invalid-token");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Invalid or expired token");
    });

    it("should return valid: false for 403 forbidden", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 403,
            statusText: "Forbidden",
        });

        const result = await CloudflareClient.validateToken(
            "insufficient-permissions",
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Token lacks required permissions");
    });

    it("should return valid: false for other HTTP errors", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
        });

        const result = await CloudflareClient.validateToken("any-token");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("HTTP 500: Internal Server Error");
    });

    it("should return valid: false when API returns success: false", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: false,
                errors: [{ code: 10000, message: "Authentication failed" }],
            }),
        });

        const result = await CloudflareClient.validateToken("failed-token");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Authentication failed");
    });

    it("should return valid: false when token is not active", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: true,
                result: { id: "test-id", status: "inactive" },
            }),
        });

        const result = await CloudflareClient.validateToken("inactive-token");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Token is not active");
    });

    it("should handle network errors", async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

        const result = await CloudflareClient.validateToken("any-token");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Network error");
    });

    it("should handle unknown errors", async () => {
        (global.fetch as any).mockRejectedValueOnce("Unknown error");

        const result = await CloudflareClient.validateToken("any-token");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Network error during validation");
    });

    it("should call the correct Cloudflare API endpoint", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: true,
                result: { id: "test-id", status: "active" },
            }),
        });

        await CloudflareClient.validateToken("test-token");

        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.cloudflare.com/client/v4/user/tokens/verify",
            {
                method: "GET",
                headers: {
                    Authorization: "Bearer test-token",
                    "Content-Type": "application/json",
                },
            },
        );
    });
});
