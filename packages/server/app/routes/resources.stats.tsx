import type { LoaderFunctionArgs } from "react-router";
import {
    getDateTimeRange,
    getFiltersFromSearchParams,
    paramsFromUrl,
} from "~/lib/utils";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Card } from "~/components/ui/card";
import { SearchFilters } from "~/lib/types";
import { requireAuth } from "~/lib/auth";

export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    const { analyticsEngine, sessionAnalytics } = context;
    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    const { startDate, endDate } = getDateTimeRange(interval, tz);
    if (sessionAnalytics) {
        try {
            const sessionMetrics = await sessionAnalytics.getSessionMetrics(
                site,
                startDate,
                endDate,
                filters,
            );
            return {
                views: sessionMetrics.views,
                visitors: sessionMetrics.visitors,
                visits: sessionMetrics.visits,
                bounceRate:
                    sessionMetrics.visits > 0
                        ? sessionMetrics.bounces / sessionMetrics.visits
                        : undefined,
                averageVisitDuration: sessionMetrics.averageVisitDuration,
                hasSufficientBounceData: true,
            };
        } catch (error) {
            console.error(
                "R2 session query failed; using realtime metrics",
                error,
            );
        }
    }

    const [counts, { earliestEvent, earliestBounce }] = await Promise.all([
        analyticsEngine.getCounts(site, interval, tz, filters),
        analyticsEngine.getEarliestEvents(site),
    ]);

    // FOR BACKWARDS COMPAT, ONLY SHOW BOUNCE RATE IF WE HAVE DATE FOR THE ENTIRE QUERY PERIOD
    // -----------------------------------------------------------------------------
    // Bounce rate is a later-introduced metric that may not have been recorded for
    // the full duration of the queried Counterscale dataset (not possible to backfill
    // data we dont have!)

    // So, cannot reliably show "bounce rate" if bounce data was unavailable for a portion
    // of the query period.

    // To figure out if we can give an answer or not, we inspect the earliest bounce/earliest event
    // data recorded, and determine if our dataset is "complete" for the given query interval.

    const hasSufficientBounceData =
        earliestBounce !== null &&
        earliestEvent !== null &&
        (earliestEvent.getTime() == earliestBounce.getTime() || // earliest event recorded a bounce -- any query is fine
            earliestBounce < startDate); // earliest bounce occurred before start of query period -- this query is fine

    const bounceRate =
        counts.visitors > 0 ? counts.bounces / counts.visitors : undefined;

    return {
        views: counts.views,
        visitors: counts.visitors,
        bounceRate: bounceRate,
        hasSufficientBounceData,
    };
}

function formatDuration(seconds: number): string {
    const rounded = Math.round(seconds);
    if (rounded < 60) return `${rounded}s`;
    const minutes = Math.floor(rounded / 60);
    return `${minutes}m ${rounded % 60}s`;
}

export const StatsCard = ({
    siteId,
    interval,
    filters,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    timezone: string;
}) => {
    const dataFetcher = useFetcher<typeof loader>();

    const {
        views,
        visitors,
        visits,
        bounceRate,
        averageVisitDuration,
        hasSufficientBounceData,
    } = dataFetcher.data || {};
    const countFormatter = Intl.NumberFormat("en", { notation: "compact" });
    const hasSessionMetrics = visits !== undefined;

    useEffect(() => {
        const params = {
            site: siteId,
            interval,
            timezone,
            ...filters,
        };

        dataFetcher.submit(params, {
            method: "get",
            action: `/resources/stats`,
        });
        // NOTE: dataFetcher is intentionally omitted from the useEffect dependency array
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    return (
        <Card>
            <div className="p-4 pl-6">
                <div
                    className={`grid grid-cols-2 gap-8 items-end ${hasSessionMetrics ? "sm:grid-cols-5" : "sm:grid-cols-3"}`}
                >
                    <div>
                        <div className="text-md sm:text-lg">Visitors</div>
                        <div className="text-4xl">
                            {visitors ? countFormatter.format(visitors) : "-"}
                        </div>
                    </div>

                    {hasSessionMetrics ? (
                        <div>
                            <div className="text-md sm:text-lg">Visits</div>
                            <div className="text-4xl">
                                {countFormatter.format(visits)}
                            </div>
                        </div>
                    ) : null}
                    <div>
                        <div className="text-md sm:text-lg">Views</div>
                        <div className="text-4xl">
                            {views ? countFormatter.format(views) : "-"}
                        </div>
                    </div>
                    {hasSessionMetrics ? (
                        <div>
                            <div className="text-md sm:text-lg">
                                Avg. duration
                            </div>
                            <div className="text-4xl">
                                {averageVisitDuration !== undefined &&
                                averageVisitDuration !== null
                                    ? formatDuration(averageVisitDuration)
                                    : "-"}
                            </div>
                        </div>
                    ) : null}
                    <div>
                        <div className="text-md sm:text-lg">
                            <span>
                                Bounce
                                <span className="hidden sm:inline"> Rate</span>
                            </span>
                        </div>
                        <div className="text-4xl">
                            {hasSufficientBounceData
                                ? bounceRate !== undefined
                                    ? `${Math.round(bounceRate * 100)}%`
                                    : "-"
                                : "n/a"}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};
