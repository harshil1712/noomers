export async function handleRealtime(request: Request, env: Env, url: URL): Promise<Response> {
  const siteId = decodeURIComponent(url.pathname.slice("/realtime/".length));
  if (!siteId) return new Response("Not Found", { status: 404 });
  if (!env.SITE_EVENTS) {
    return new Response("Realtime unavailable", { status: 503 });
  }
  // Reject cross-site WebSocket upgrades — the dashboard only ever
  // connects from its own origin.
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).origin;
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    if (originHost !== url.origin) {
      return new Response("Forbidden", { status: 403 });
    }
  }
  // Dashboard session (Better Auth) — replaced the legacy __noomers_token
  // JWT when auth moved to Better Auth in the fastflare migration.
  const { createAuth } = await import("./auth");
  const { SitesRepository } = await import("./sites/repository");
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const repository = new SitesRepository(env.DB);
  if ((await repository.collectionStatus(siteId)) !== "active") {
    return new Response("Not Found", { status: 404 });
  }
  const namespace = env.SITE_EVENTS;
  return namespace.get(namespace.idFromName(siteId)).fetch(request);
}
