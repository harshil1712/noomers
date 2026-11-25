import { secretsEqual } from "../lib/secrets";
import { ApiKeysRepository, hashApiKey, type ApiKeyScope } from "../api-keys/repository";

function invalidKey() {
  return Response.json({ error: "Invalid API key" }, { status: 401 });
}

/**
 * Bearer-token gate for the Plausible-compatible APIs.
 *
 * `scope "stats"` (Read-only in the UI) gates /api/v2/query; `scope "sites"`
 * (Full access) gates /api/v1/*. A dashboard-managed `nmr_` key with scope
 * "sites" also satisfies "stats".
 * Environment tokens remain as fallback: SITES_API_TOKEN only covers "sites",
 * STATS_API_TOKEN covers both (it predates the split).
 */
export async function requireAPIKey(
  request: Request,
  env: Env,
  scope: ApiKeyScope,
): Promise<Response | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return invalidKey();

  const envTokens =
    scope === "sites" ? [env.SITES_API_TOKEN, env.STATS_API_TOKEN] : [env.STATS_API_TOKEN];
  for (const expected of envTokens) {
    if (expected && (await secretsEqual(token, expected))) return null;
  }

  if (token.startsWith("nmr_")) {
    const repository = new ApiKeysRepository(env.DB);
    const row = await repository.findActiveByHash(await hashApiKey(token));
    if (row && (row.scope === "sites" || row.scope === scope)) {
      await repository.touch(row.id);
      return null;
    }
  }

  return invalidKey();
}
