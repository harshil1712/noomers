import type { LoaderFunctionArgs } from "react-router";
import { requireAPIKey } from "~/api/auth";
import { SINGLE_ORGANIZATION } from "~/sites/team";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const unauthorized = requireAPIKey(request, context.cloudflare.env);
    if (unauthorized) return unauthorized;

    return Response.json({
        teams: [SINGLE_ORGANIZATION],
        meta: { after: null, before: null, limit: 100 },
    });
}
