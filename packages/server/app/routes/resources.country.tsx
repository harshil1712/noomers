import { useFetcher } from "react-router";
import { requireAuth } from "~/lib/auth";
import { breakdownLoader } from "./resources.shared";
import type { LoaderFunctionArgs } from "react-router";
import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";
import PaginatedTableCard from "~/components/PaginatedTableCard";
import { SearchFilters } from "~/lib/types";

function convertCountryCodesToNames(
    countByCountry: [string, number][],
): [[string, string], number][] {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return countByCountry.map((countByBrowserRow) => {
        let countryName;
        try {
            // throws an exception if country code isn't valid
            //   use try/catch to be defensive and not explode if an invalid
            //   country code gets insrted into Analytics Engine
            countryName = regionNames.of(countByBrowserRow[0])!; // "United States"
        } catch {
            countryName = "(unknown)";
        }
        const count = countByBrowserRow[1];
        return [[countByBrowserRow[0], countryName], count];
    });
}

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return breakdownLoader(context, request, "visit:country", "visits");
}

export const CountryCard = ({
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
            columnHeaders={["Country", "Visitors"]}
            dataFetcher={useFetcher<typeof loader>()}
            loaderUrl="/resources/country"
            filters={filters}
            onClick={(country) => onFilterChange({ ...filters, country })}
            timezone={timezone}
        />
    );
};
