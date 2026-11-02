import { useFetcher } from "react-router";
import { breakdownLoader } from "./resources.shared";
import type { LoaderFunctionArgs } from "react-router";

import PaginatedTableCard from "~/components/PaginatedTableCard";
import { requireAuth } from "~/lib/auth";
import type { SearchFilters } from "~/lib/types";
import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return breakdownLoader(context, request, "event:name", "events");
}

export function EventsCard({
    siteId,
    interval,
    filters,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    timezone: string;
}) {
    return (
        <PaginatedTableCard
            siteId={siteId}
            interval={interval}
            columnHeaders={["Event", "Events"]}
            dataFetcher={useFetcher<typeof loader>()}
            filters={filters}
            loaderUrl="/resources/events"
            timezone={timezone}
        />
    );
}
