import { createRequestHandler, type ServerBuild } from "react-router";

/**
 * NOTE: Must use relative paths inside this file (no ~ shorthand), because
 * it gets packaged into Worker and special paths defined in tsconfig will not
 * resolve.
 */
import { getLoadContext } from "../app/load-context";
import * as build from "../build/server";
import { SiteEvents } from "./site-events";

export { SiteEvents };

const requestHandler = createRequestHandler(build as unknown as ServerBuild);

export default {
    async fetch(request: any, env: Env, ctx: any) {
        try {
            const url = new URL(request.url);
            if (url.pathname.startsWith("/realtime/")) {
                return await handleRealtime(request, env, url);
            }
            const loadContext = getLoadContext({
                request,
                context: {
                    cloudflare: {
                        ctx: {
                            waitUntil: ctx.waitUntil.bind(ctx),
                            passThroughOnException:
                                ctx.passThroughOnException.bind(ctx),
                            props: ctx.props,
                        },
                        cf: request.cf as never,
                        // @ts-expect-error TODO: figure out how to get this type to work
                        caches,
                        env: env as Env & { CF_PAGES_COMMIT_SHA: string },
                    },
                },
            });
            return await requestHandler(request, loadContext);
        } catch (error) {
            console.log(error);
            return new Response("An unexpected error occurred", {
                status: 500,
            });
        }
    },
} satisfies ExportedHandler<Env>;

async function handleRealtime(
    request: Request,
    env: Env,
    url: URL,
): Promise<Response> {
    const siteId = decodeURIComponent(url.pathname.slice("/realtime/".length));
    if (!siteId) return new Response("Not Found", { status: 404 });
    if (!env.SITE_EVENTS) {
        return new Response("Realtime unavailable", { status: 503 });
    }
    const { getUser } = await import("../app/lib/auth");
    const { SitesRepository } = await import("../app/sites/repository");
    const user = await getUser(request, env);
    if (!user.authenticated) {
        return new Response("Unauthorized", { status: 401 });
    }
    const repository = new SitesRepository(env.GOALS_DB);
    if ((await repository.collectionStatus(siteId)) !== "active") {
        return new Response("Not Found", { status: 404 });
    }
    const namespace = env.SITE_EVENTS;
    return namespace.get(namespace.idFromName(siteId)).fetch(request);
}
