import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";

function notImplemented() {
    return Response.json({ error: "Not Implemented" }, { status: 501 });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    return unauthorized || notImplemented();
}

export async function action({ request, context }: ActionFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    if (request.method === "PUT" || request.method === "DELETE") return notImplemented();
    return Response.json({ error: "Method Not Allowed" }, { status: 405 });
}
