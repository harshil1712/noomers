import type { ActionFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";

export async function action({ request, context }: ActionFunctionArgs) {
    const unauthorized = await requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;
    if (request.method === "DELETE") {
        return Response.json({ error: "Not Implemented" }, { status: 501 });
    }
    return Response.json({ error: "Method Not Allowed" }, { status: 405 });
}
