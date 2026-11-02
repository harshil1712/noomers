import type { AppLoadContext } from "react-router";
import {
    getDateTimeRange,
    getFiltersFromSearchParams,
    paramsFromUrl,
} from "~/lib/utils";
import type { SessionDimension, SessionMetricsRow } from "~/analytics/r2-sql";

/** [dimension, visitors, secondary metric] tuples consumed by TableCard. */
export type CountRow =
    | [string | [string, string], number, number]
    | [string | [string, string], number];

const PAGE_SIZE = 10;

/**
 * Shared loader body for the dashboard breakdown cards. Visit dimensions
 * (referrer, utm_*, country, browser, device) are attributed from each
 * session's first pageview; event dimensions (page, event name) count rows.
 */
export async function breakdownLoader(
    context: AppLoadContext,
    request: Request,
    dimension: SessionDimension,
    metric: "visitors" | "visits" | "views" | "events",
    transform?: (rows: CountRow[]) => CountRow[],
): Promise<{ countsByProperty: CountRow[]; page: number }> {
    const { interval = "7d", site, page = 1 } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);
    const { startDate, endDate } = getDateTimeRange(interval, tz);
    const analytics = context.sessionAnalytics();

    const isVisit = dimension.startsWith("visit:");
    const options = {
        orderBy: [{ field: metric === "views" ? ("pageviews" as const) : metric, direction: "desc" as const }],
        pagination: { limit: PAGE_SIZE, offset: (Number(page) - 1) * PAGE_SIZE },
    };

    const rows = isVisit
        ? (
            await analytics.getSessionBreakdown(
                site,
                startDate,
                endDate,
                filters,
                dimension,
                undefined,
                options,
            )
        ).rows
        : (
            await analytics.getBasicMetrics(
                site,
                startDate,
                endDate,
                filters,
                dimension,
                undefined,
                options,
            )
        ).rows.map((row): SessionMetricsRow => ({
            ...row,
            dimension: row.dimension ?? "",
            visits: 0,
            bounces: 0,
            averageVisitDuration: null,
        }));

    const countRows = rows.map((row): CountRow =>
            metric === "events"
                ? [row.dimension, row.events]
                : [
                      row.dimension,
                      row.visitors,
                      metric === "visits" ? row.visits : row.views,
                  ],
    );
    return {
        countsByProperty: transform ? transform(countRows) : countRows,
        page: Number(page),
    };
}
