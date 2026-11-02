import { timingSafeEqual } from "./secrets";

const encoder = new TextEncoder();

function base64urlEncode(data: ArrayBuffer | string): string {
    const bytes =
        typeof data === "string"
            ? encoder.encode(data)
            : new Uint8Array(data);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(input)) {
        throw new Error("Invalid base64url input");
    }
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        usages,
    );
}

export interface JWTPayload {
    authenticated?: boolean;
    iat?: number;
    exp?: number;
    iss?: string;
    [key: string]: unknown;
}

export async function signJWT(
    payload: JWTPayload,
    secret: string,
): Promise<string> {
    const header = base64urlEncode(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
    );
    const body = base64urlEncode(JSON.stringify(payload));
    const unsigned = `${header}.${body}`;
    const key = await hmacKey(secret, ["sign"]);
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(unsigned),
    );
    return `${unsigned}.${base64urlEncode(signature)}`;
}

export async function verifyJWT(
    token: string,
    secret: string,
    issuer: string,
): Promise<JWTPayload> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
        throw new Error("Malformed token");
    }
    const [encodedHeader, encodedBody, encodedSignature] = parts;

    let header: { alg?: unknown };
    let payload: JWTPayload;
    let signature: Uint8Array;
    try {
        header = JSON.parse(
            new TextDecoder().decode(base64urlDecode(encodedHeader)),
        );
        payload = JSON.parse(
            new TextDecoder().decode(base64urlDecode(encodedBody)),
        );
        signature = base64urlDecode(encodedSignature);
    } catch {
        throw new Error("Malformed token");
    }

    if (header.alg !== "HS256") {
        throw new Error("Unsupported algorithm");
    }

    const key = await hmacKey(secret, ["sign"]);
    const expected = new Uint8Array(
        await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(`${encodedHeader}.${encodedBody}`),
        ),
    );
    if (!timingSafeEqual(signature, expected)) {
        throw new Error("Invalid signature");
    }

    if (
        typeof payload.exp !== "number" ||
        payload.exp <= Math.floor(Date.now() / 1000)
    ) {
        throw new Error("Token expired");
    }

    if (payload.iss !== issuer) {
        throw new Error("Invalid issuer");
    }

    return payload;
}
