import { secretsEqual } from "../lib/secrets";

export async function requireAPIKey(request: Request, env: Env): Promise<Response | null> {
  const token = env.SITES_API_TOKEN || env.STATS_API_TOKEN;
  const authorization = request.headers.get("Authorization");
  if (!token || !authorization || !(await secretsEqual(authorization, `Bearer ${token}`))) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }
  return null;
}
