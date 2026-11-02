import type { LoaderFunctionArgs } from "react-router";
import {
    getFiltersFromSearchParams,
    paramsFromUrl,
    getIntervalType,
    getDateTimeRange,
} from "~/lib/utils";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import TimeSeriesChart from "~/components/TimeSeriesChart";
import { SearchFilters } from "~/lib/types";
import { requireAuth } from "~/lib/auth";
import { getTimeBuckets } from "~/analytics/stats-api";

export async function loader({
    context,
    request,
}: LoaderFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);

    const { interval, site } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    const intervalType = getIntervalType(interval);
    const { startDate, endDate } = getDateTimeRange(interval, tz);
    const dimension = intervalType === "HOUR" ? "time:hour" : "time:day";
    const buckets = getTimeBuckets(dimension, startDate, endDate, tz);

    const { rows } = await context
        .sessionAnalytics()
        .getSessionBreakdown(
            site,
            startDate,
            endDate,
            filters,
            dimension,
            buckets,
            { orderBy: [{ field: "dimension", direction: "asc" }] },
        );

    const chartData: {
        date: string;
        views: number;
        visitors: number;
        bounceRate: number;
    }[] = rows.map((row: { dimension: string; views: number; visitors: number; visits: number; bounces: number }) => ({
        date: row.dimension,
        views: row.views,
        visitors: row.visitors,
        bounceRate: Math.floor(
            (row.visits > 0 ? row.bounces / row.visits : 0) * 100,
        ),
    }));

    return {
        chartData: chartData,
        intervalType: intervalType,
    };
}

export const TimeSeriesCard = ({
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
    const { chartData, intervalType } = dataFetcher.data || {};

    useEffect(() => {
        const params = {
            site: siteId,
            interval,
            timezone,
            ...filters,
        };

        dataFetcher.submit(params, {
            method: "get",
            action: `/resources/timeseries`,
        });
        // NOTE: dataFetcher is intentionally omitted from the useEffect dependency array
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, interval, filters, timezone]);

    return (
        <Card>
            <CardContent>
                <div className="h-72 pt-6 -m-4 -mr-10 -ml-10 sm:-m-2 sm:-ml-6 sm:-mr-6">
                    {chartData && (
                        <TimeSeriesChart
                            data={chartData}
                            intervalType={intervalType}
                        />
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
