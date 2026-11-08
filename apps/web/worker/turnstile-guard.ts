/**
 * Fail-safe against shipping Cloudflare's always-pass Turnstile test keys to
 * a real host. A preview/dev deploy needs its own widget — this guard makes a
 * test-key deploy fail loudly instead of insecurely.
 */
const TEST_PREFIXES = ["1x0000", "2x0000", "3x0000"];

function isLocalHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export function assertTurnstileConfig(secretKey: string | undefined, baseUrl: string): void {
  if (!secretKey) {
    throw new Error("[auth] TURNSTILE_SECRET_KEY is not configured");
  }
  if (TEST_PREFIXES.some((p) => secretKey.startsWith(p)) && !isLocalHost(baseUrl)) {
    throw new Error(
      `[auth] Cloudflare Turnstile TEST secret key on non-local host (${baseUrl}) — a real widget must be provisioned for this stage.`,
    );
  }
}
