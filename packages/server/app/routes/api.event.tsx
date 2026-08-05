import type { ActionFunctionArgs } from "react-router";
import { plausibleEventRequestHandler } from "~/analytics/plausible";

export function loader() {
    return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
    });
}

export async function action({ request, context }: ActionFunctionArgs) {
    return plausibleEventRequestHandler(
        request,
        context.cloudflare.env,
        context.cloudflare.cf,
    );
}
