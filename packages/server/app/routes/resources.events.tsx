import { useFetcher } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import PaginatedTableCard from "~/components/PaginatedTableCard";
import { requireAuth } from "~/lib/auth";
import type { SearchFilters } from "~/lib/types";
import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    const { analyticsEngine } = context;
    const { interval, site, page = 1 } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const timezone = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    return {
        countsByProperty: await analyticsEngine.getCountByEventName(
            site,
            interval,
            timezone,
            filters,
            Number(page),
        ),
        page: Number(page),
    };
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
