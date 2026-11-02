import { useFetcher } from "react-router";
import { requireAuth } from "~/lib/auth";
import { breakdownLoader } from "./resources.shared";

import type { LoaderFunctionArgs } from "react-router";

import PaginatedTableCard from "~/components/PaginatedTableCard";
import { SearchFilters } from "~/lib/types";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return breakdownLoader(context, request, "visit:utm_campaign", "visits");
}

export const UtmCampaignCard = ({
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
            columnHeaders={["UTM Campaign", "Visitors", "Visits"]}
            dataFetcher={useFetcher<typeof loader>()}
            loaderUrl="/resources/utm-campaign"
            filters={filters}
            onClick={(utmCampaign) =>
                onFilterChange({ ...filters, utmCampaign })
            }
            timezone={timezone}
        />
    );
};
