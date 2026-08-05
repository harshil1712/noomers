export function requireAPIKey(request: Request, env: Env): Response | null {
    const token = env.SITES_API_TOKEN || env.STATS_API_TOKEN;
    if (!token || request.headers.get("Authorization") !== `Bearer ${token}`) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
    }
    return null;
}
