import { SiteEvents } from "./site-events";

export { SiteEvents };

export default {
    async fetch(request: Request, env: Env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/realtime/")) {
            const { handleRealtime } = await import("./realtime");
            return handleRealtime(request, env, url);
        }
        return new Response("ok");
    },
};
