import type { LoaderFunctionArgs } from "react-router";
import { breakdownLoader } from "./resources.shared";
import { requireAuth } from "~/lib/auth";

/**
 * GET /resources/props?site=<d>&interval=<i>&event=<name>&key=<prop>
 * Custom-event property breakdown (Plausible "props" view), e.g. which
 * outbound URL or file was clicked. Requires an exact event name and a
 * property key; returns the standard CountRow shape.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    const url = new URL(request.url);
    const eventName = url.searchParams.get("event") || "";
    const key = url.searchParams.get("key") || "";
    if (!eventName || !/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
        return Response.json(
            { error: "event and key are required" },
            { status: 400 },
        );
    }
    // The name filter reaches the query via SearchFilters.name —
    // set it through a synthetic request URL so breakdownLoader's
    // normal filter parsing applies.
    const u = new URL(request.url);
    u.searchParams.set("name", eventName);
    const filtered = new Request(u, request);
    return breakdownLoader(
        context,
        filtered,
        `event:props:${key}` as never,
        "events",
    );
}
