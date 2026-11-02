import { useFetcher } from "react-router";
import { requireAuth } from "~/lib/auth";
import { breakdownLoader } from "./resources.shared";
import type { LoaderFunctionArgs } from "react-router";
import PaginatedTableCard from "~/components/PaginatedTableCard";
import type { CountRow } from "~/routes/resources.shared";
import { SearchFilters } from "~/lib/types";


const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// Codes are normalized to names on the server only — Intl.DisplayNames
// differs across browsers and would cause hydration mismatches.
function toCountryRows(rows: CountRow[]): CountRow[] {
    return rows.map((row) => {
        const code = Array.isArray(row[0]) ? row[0][0] : row[0];
        let name = "(unknown)";
        try {
            name = regionNames.of(code)!;
        } catch {
            // invalid code falls through to (unknown)
        }
        return [[code, name], ...row.slice(1)] as CountRow;
    });
}

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    return breakdownLoader(
        context,
        request,
        "visit:country",
        "visits",
        toCountryRows,
    );
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
            columnHeaders={["Country", "Visitors", "Visits"]}
            dataFetcher={useFetcher<typeof loader>()}
            loaderUrl="/resources/country"
            filters={filters}
            onClick={(country) => onFilterChange({ ...filters, country })}
            timezone={timezone}
        />
    );
};
