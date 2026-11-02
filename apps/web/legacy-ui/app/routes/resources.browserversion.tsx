import { useFetcher } from "react-router";
import { requireAuth } from "~/lib/auth";
import { breakdownLoader } from "./resources.shared";

import type { LoaderFunctionArgs } from "react-router";

import PaginatedTableCard from "~/components/PaginatedTableCard";
import { SearchFilters } from "~/lib/types";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return breakdownLoader(context, request, "visit:browser_version", "visits");
}

export const BrowserVersionCard = ({
    siteId,
    interval,
    filters,
    onFilterChange,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    timezone: string;
}) => {
    return (
        <PaginatedTableCard
            siteId={siteId}
            interval={interval}
            columnHeaders={[`${filters.browserName} Versions`, "Visitors", "Visits"]}
            dataFetcher={useFetcher<typeof loader>()}
            loaderUrl="/resources/browserversion"
            onClick={(browserVersion) =>
                onFilterChange({ ...filters, browserVersion })
            }
            filters={filters}
            timezone={timezone}
        />
    );
};
