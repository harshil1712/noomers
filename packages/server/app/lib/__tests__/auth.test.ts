import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { login, logout, requireAuth, getUser, isAuthEnabled } from "../auth";
import { createJWTCookie, clearJWTCookie } from "../session";
import bcrypt from "bcryptjs";
import { signJWT, verifyJWT, type JWTPayload } from "../jwt";

const JWT_SECRET = "test-secret-key-for-jwt-signing-and-verification";

function makeToken(
    overrides: Partial<JWTPayload> = {},
    secret = JWT_SECRET,
): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return signJWT(
        {
            authenticated: true,
            iat,
            exp: iat + 60 * 60 * 24 * 30,
            iss: "noomers",
            ...overrides,
        },
        secret,
    );
}

vi.mock("../session");
vi.mock("bcryptjs");
vi.mock("react-router", () => ({
    redirect: vi.fn((url, options) => ({ url, options })),
}));

const mockEnv = {
    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
    CF_JWT_SECRET: JWT_SECRET,
} as Env;

const mockEnvAuthDisabled = {
    CF_BEARER_TOKEN: "test-bearer-token",
    CF_ACCOUNT_ID: "test-account-id",
    CF_AUTH_ENABLED: "false",
} as Env;

describe("auth", () => {
    beforeEach(() => {
        vi.mocked(createJWTCookie).mockReturnValue(
            "__noomers_token=test-jwt; HttpOnly; Max-Age=2592000; Path=/; SameSite=Lax",
        );
        vi.mocked(clearJWTCookie).mockReturnValue(
            "__noomers_token=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax",
        );
        vi.mocked(bcrypt.compare).mockResolvedValue(true as any);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });
    
    describe("isAuthEnabled", () => {
        test("should return true when CF_AUTH_ENABLED is true", () => {
            const env = {
                ...mockEnv,
                CF_AUTH_ENABLED: "true",
            } as Env;
            
            expect(isAuthEnabled(env)).toBe(true);
        });
        
        test("should return false when CF_AUTH_ENABLED is false", () => {
            const env = {
                ...mockEnv,
                CF_AUTH_ENABLED: "false",
            } as Env;
            
            expect(isAuthEnabled(env)).toBe(false);
        });
        
        test("should return true when CF_AUTH_ENABLED is not set but password secrets exist", () => {
            //@ts-expect-error emulate missing var
            const env = {
                ...mockEnv,
                CF_AUTH_ENABLED: undefined,
            } as Env;
            
            expect(isAuthEnabled(env)).toBe(true);
        });
        
        test("should throw error when CF_AUTH_ENABLED is true but password secrets are missing", () => {
            const env = {
                CF_AUTH_ENABLED: "true",
                CF_BEARER_TOKEN: "test-bearer-token",
                CF_ACCOUNT_ID: "test-account-id",
            } as Env;
            
            expect(() => isAuthEnabled(env)).toThrow("Authentication is enabled but password secrets are missing");
        });
    });

    describe("login", () => {
        test("should login successfully with correct password", async () => {
            const request = new Request("http://localhost");

            const result = await login(request, "test-password", mockEnv);

            expect(bcrypt.compare).toHaveBeenCalledWith(
                "test-password",
                mockEnv.CF_PASSWORD_HASH,
            );
            expect(createJWTCookie).toHaveBeenCalledWith(expect.any(String));

            // Verify the JWT token that was created
            const createJWTCookieCall =
                vi.mocked(createJWTCookie).mock.calls[0][0];
            const decoded = await verifyJWT(
                createJWTCookieCall,
                mockEnv.CF_JWT_SECRET,
                "noomers",
            );
            expect(decoded.authenticated).toBe(true);
            expect(decoded.iat).toBeTypeOf("number");
            expect(decoded.iss).toBe("noomers");

            expect(result).toEqual({
                url: "/dashboard",
                options: {
                    headers: {
                        "Set-Cookie":
                            "__noomers_token=test-jwt; HttpOnly; Max-Age=2592000; Path=/; SameSite=Lax",
                    },
                },
            });
        });

        test("should throw error with incorrect password", async () => {
            vi.mocked(bcrypt.compare).mockResolvedValue(false as any);
            const request = new Request("http://localhost");

            await expect(
                login(request, "wrong-password", mockEnv),
            ).rejects.toThrow("Invalid password");

            expect(bcrypt.compare).toHaveBeenCalledWith(
                "wrong-password",
                mockEnv.CF_PASSWORD_HASH,
            );
        });
        
        test("should redirect to dashboard when auth is disabled", async () => {
            const request = new Request("http://localhost");

            const result = await login(request, "any-password", mockEnvAuthDisabled);

            // Should not attempt to verify password
            expect(bcrypt.compare).not.toHaveBeenCalled();
            
            // Should redirect directly to dashboard without setting cookie
            expect(result).toEqual({
                url: "/dashboard",
                options: undefined,
            });
        });
    });

    describe("logout", () => {
        test("should logout successfully", async () => {
            const request = new Request("http://localhost", {
                headers: { Cookie: "__noomers_token=some-jwt" },
            });

            const result = await logout(request, mockEnv);

            expect(clearJWTCookie).toHaveBeenCalled();
            expect(result).toEqual({
                url: "/",
                options: {
                    headers: {
                        "Set-Cookie":
                            "__noomers_token=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax",
                    },
                },
            });
        });

        test("should handle request without cookie header", async () => {
            const request = new Request("http://localhost");

            const result = await logout(request, mockEnv);

            expect(clearJWTCookie).toHaveBeenCalled();
            expect(result).toEqual({
                url: "/",
                options: {
                    headers: {
                        "Set-Cookie":
                            "__noomers_token=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax",
                    },
                },
            });
        });
    });

    describe("requireAuth", () => {
        test("should return user when authenticated", async () => {
            const validToken = await makeToken();

            const request = new Request("http://localhost", {
                headers: { Cookie: `__noomers_token=${validToken}` },
            });

            const result = await requireAuth(request, mockEnv);

            expect(result).toEqual({ authenticated: true });
        });

        test("should redirect when not authenticated", async () => {
            const request = new Request("http://localhost");

            await expect(requireAuth(request, mockEnv)).rejects.toEqual({
                url: "/",
                options: undefined,
            });
        });

        test("should redirect when JWT is invalid", async () => {
            const request = new Request("http://localhost", {
                headers: { Cookie: "__noomers_token=invalid-jwt" },
            });

            await expect(requireAuth(request, mockEnv)).rejects.toEqual({
                url: "/",
                options: undefined,
            });
        });

        test("should redirect when JWT is expired", async () => {
            const expiredToken = await makeToken({
                exp: Math.floor(Date.now() / 1000) - 10,
            });

            const request = new Request("http://localhost", {
                headers: { Cookie: `__noomers_token=${expiredToken}` },
            });

            await expect(requireAuth(request, mockEnv)).rejects.toEqual({
                url: "/",
                options: undefined,
            });
        });
        
        test("should always return authenticated user when auth is disabled", async () => {
            const request = new Request("http://localhost");

            const result = await requireAuth(request, mockEnvAuthDisabled);

            expect(result).toEqual({ authenticated: true });
        });
    });

    describe("getUser", () => {
        test("should return user object when authenticated with valid JWT", async () => {
            const validToken = await makeToken();

            const request = new Request("http://localhost", {
                headers: { Cookie: `__noomers_token=${validToken}` },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: true });
        });

        test("should return { authenticated: false } when no cookie header", async () => {
            const request = new Request("http://localhost");

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });

        test("should return { authenticated: false } when no JWT token in cookie", async () => {
            const request = new Request("http://localhost", {
                headers: { Cookie: "other-cookie=value" },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });

        test("should return { authenticated: false } when JWT is invalid", async () => {
            const request = new Request("http://localhost", {
                headers: { Cookie: "__noomers_token=invalid-jwt" },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });

        test("should return { authenticated: false } when JWT is expired", async () => {
            const expiredToken = await makeToken({
                exp: Math.floor(Date.now() / 1000) - 10,
            });

            const request = new Request("http://localhost", {
                headers: { Cookie: `__noomers_token=${expiredToken}` },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });

        test("should return { authenticated: false } when JWT payload is not authenticated", async () => {
            const unauthenticatedToken = await makeToken({
                authenticated: false,
            });

            const request = new Request("http://localhost", {
                headers: {
                    Cookie: `__noomers_token=${unauthenticatedToken}`,
                },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });

        test("should return { authenticated: false } when JWT has wrong issuer", async () => {
            const wrongIssuerToken = await makeToken({
                iss: "wrong-issuer",
            });

            const request = new Request("http://localhost", {
                headers: { Cookie: `__noomers_token=${wrongIssuerToken}` },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });

        test("should return { authenticated: false } when JWT signed with wrong secret", async () => {
            const wrongSecretToken = await makeToken({}, "wrong-secret");

            const request = new Request("http://localhost", {
                headers: { Cookie: `__noomers_token=${wrongSecretToken}` },
            });

            const result = await getUser(request, mockEnv);

            expect(result).toEqual({ authenticated: false });
        });
        
        test("should always return authenticated user when auth is disabled", async () => {
            const request = new Request("http://localhost");

            const result = await getUser(request, mockEnvAuthDisabled);

            expect(result).toEqual({ authenticated: true });
        });
    });
});

describe("jwt", () => {
    const ISSUER = "noomers";

    test("verifies a token produced by the previous jsonwebtoken settings", async () => {
        // Generated with jsonwebtoken@9:
        //   jwt.sign({authenticated: true, iat: 1700000000, exp: 2000000000},
        //            JWT_SECRET, {issuer: "noomers"})
        const fixture =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJhdXRoZW50aWNhdGVkIjp0cnVlLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMCwiaXNzIjoibm9vbWVycyJ9." +
            "Z4WGsx8VAwovKoNRjI8l50ATaZDAPC0LdcAE7sysboo";

        const decoded = await verifyJWT(fixture, JWT_SECRET, ISSUER);

        expect(decoded.authenticated).toBe(true);
        expect(decoded.iss).toBe(ISSUER);
    });

    test("produces tokens that follow the standard JWT format", async () => {
        const token = await makeToken();
        const [header] = token.split(".");

        expect(JSON.parse(atob(header))).toEqual({
            alg: "HS256",
            typ: "JWT",
        });
        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).resolves.toMatchObject(
            { authenticated: true, iss: ISSUER },
        );
    });

    test("rejects a token signed with the none algorithm", async () => {
        const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
        const body = btoa(
            JSON.stringify({
                authenticated: true,
                exp: Math.floor(Date.now() / 1000) + 3600,
                iss: ISSUER,
            }),
        );
        const token = `${header}.${body}.`;

        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).rejects.toThrow();
    });

    test("rejects a token declaring a different algorithm", async () => {
        // Well-formed token whose header claims HS384
        const header = btoa(JSON.stringify({ alg: "HS384", typ: "JWT" }))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        const body = btoa(
            JSON.stringify({
                authenticated: true,
                exp: Math.floor(Date.now() / 1000) + 3600,
                iss: ISSUER,
            }),
        )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        const token = `${header}.${body}.ZmFrZXNpZw`;

        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).rejects.toThrow();
    });

    test("rejects a token with a tampered payload", async () => {
        const token = await makeToken();
        const [header, , signature] = token.split(".");
        const tamperedBody = btoa(
            JSON.stringify({
                authenticated: true,
                exp: Math.floor(Date.now() / 1000) + 3600,
                iss: ISSUER,
                admin: true,
            }),
        )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

        await expect(
            verifyJWT(`${header}.${tamperedBody}.${signature}`, JWT_SECRET, ISSUER),
        ).rejects.toThrow();
    });

    test("rejects a token signed with the wrong secret", async () => {
        const token = await makeToken({}, "wrong-secret");

        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).rejects.toThrow();
    });

    test("rejects an expired token", async () => {
        const token = await makeToken({
            exp: Math.floor(Date.now() / 1000) - 10,
        });

        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).rejects.toThrow();
    });

    test("rejects a token with the wrong issuer", async () => {
        const token = await makeToken({ iss: "wrong-issuer" });

        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).rejects.toThrow();
    });

    test.each([
        "not-a-jwt",
        "only.two",
        "a.b.c.d",
        "..",
        "a..c",
        "!!!.@@@.###",
    ])("rejects malformed token %s", async (token) => {
        await expect(verifyJWT(token, JWT_SECRET, ISSUER)).rejects.toThrow();
    });
});
