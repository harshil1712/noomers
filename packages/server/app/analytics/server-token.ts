import { secretsEqual } from "../lib/secrets";

/**
 * First-party/server event ingest may override the client IP when the
 * request authenticates with the SERVER_EVENTS_TOKEN bearer secret. The
 * token is optional; when unset every request uses cf-connecting-ip only.
 */
export async function hasServerEventsToken(
    request: Request,
    env: { SERVER_EVENTS_TOKEN?: string },
): Promise<boolean> {
    const configured = env.SERVER_EVENTS_TOKEN;
    if (!configured) return false;
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return secretsEqual(token, configured);
}
