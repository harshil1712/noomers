import { ColumnMappings } from "./schema";
import type { R2BreakdownOptions, R2OrderClause, R2OrderField, R2SQLAPI, R2StatsFilter, SessionDimension, SessionMetrics, SessionTimeBucket } from "./r2-sql";
import type { SearchFilters } from "~/lib/types";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const METRICS = [
    "visitors",
    "visits",
    "pageviews",
    "views_per_visit",
    "bounce_rate",
    "visit_duration",
    "events",
] as const;
type Metric = (typeof METRICS)[number];

const SCALAR_DIMENSIONS = {
    "event:page": { column: ColumnMappings.path, filter: "path" },
    "event:hostname": { column: ColumnMappings.host, filter: "host" },
    "event:name": { column: ColumnMappings.path, filter: "name" },
} as const;
const TIME_DIMENSIONS = [
    "time",
    "time:hour",
    "time:day",
    "time:week",
    "time:month",
] as const;
type ScalarDimension = keyof typeof SCALAR_DIMENSIONS;
type TimeDimension = (typeof TIME_DIMENSIONS)[number];
type Dimension = ScalarDimension | TimeDimension;
type FilterOperator = "is" | "is_not" | "contains" | "contains_not";
type StatsFilter = [FilterOperator, ScalarDimension, string[]];

interface StatsQuery {
    site_id: string;
    metrics: Metric[];
    date_range: string | [string, string];
    dimensions: Dimension[];
    filters: StatsFilter[];
    order_by: [Metric | Dimension, "asc" | "desc"][];
    include: { imports?: boolean; time_labels?: boolean; total_rows?: boolean };
    pagination: { limit: number; offset: number };
}

interface BasicMetrics {
    visitors: number;
    pageviews: number;
    events: number;
}

export class StatsAPIError extends Error {}

function formatRangeDate(value: Date, reportingTimezone: string, includeMilliseconds = false): string {
    return dayjs(value).tz(reportingTimezone).format(
        includeMilliseconds ? "YYYY-MM-DDTHH:mm:ss.SSSZ" : "YYYY-MM-DDTHH:mm:ssZ",
    );
}

function parseDateRange(value: unknown, reportingTimezone: string): {
    input: StatsQuery["date_range"];
    start: Date;
    end: Date;
    normalized: [string, string];
} {
    const now = new Date();
    const localNow = dayjs(now).tz(reportingTimezone);
    let start: Date;
    let end = now;
    let normalizedEnd = now;
    let preserveStartMilliseconds = false;
    let preserveEndMilliseconds = false;
    if (value === "day") {
        start = localNow.startOf("day").toDate();
    } else if (value === "24h") {
        start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (typeof value === "string" && /^(7|28|30|91)d$/.test(value)) {
        const days = Number(value.slice(0, -1));
        start = localNow.startOf("day").subtract(days - 1, "day").toDate();
    } else if (value === "month") {
        start = localNow.startOf("month").toDate();
    } else if (value === "6mo" || value === "12mo") {
        const months = Number(value.slice(0, -2));
        start = localNow.subtract(months, "month").startOf("month").toDate();
    } else if (value === "year") {
        start = localNow.startOf("year").toDate();
    } else if (value === "all") {
        start = new Date(0);
    } else if (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((part) => typeof part === "string")
    ) {
        const startIsDate = /^\d{4}-\d{2}-\d{2}$/.test(value[0]);
        const endIsDate = /^\d{4}-\d{2}-\d{2}$/.test(value[1]);
        start = startIsDate
            ? dayjs.tz(value[0], reportingTimezone).startOf("day").toDate()
            : new Date(value[0]);
        end = endIsDate
            ? dayjs.tz(value[1], reportingTimezone).add(1, "day").startOf("day").toDate()
            : new Date(value[1]);
        if (endIsDate) {
            normalizedEnd = new Date(end.getTime() - 1);
        } else {
            normalizedEnd = end;
        }
        preserveStartMilliseconds = !startIsDate && start.getUTCMilliseconds() !== 0;
        preserveEndMilliseconds = !endIsDate && end.getUTCMilliseconds() !== 0;
    } else {
        throw new StatsAPIError("Unsupported date_range");
    }
    const values = Array.isArray(value) ? value : [];
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || values.some((part) => !isStrictISODate(part))) {
        throw new StatsAPIError("date_range must contain valid ascending dates");
    }
    return {
        input: value as StatsQuery["date_range"],
        start,
        end,
        normalized: [
            formatRangeDate(start, reportingTimezone, preserveStartMilliseconds),
            formatRangeDate(normalizedEnd, reportingTimezone, preserveEndMilliseconds),
        ],
    };
}

function isStrictISODate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function parseQuery(value: unknown, reportingTimezone: string): StatsQuery & { start: Date; end: Date; normalizedRange: [string, string]; reportingTimezone: string } {
    if (!value || typeof value !== "object") throw new StatsAPIError("Request body must be an object");
    const input = value as Record<string, unknown>;
    const rootKeys = new Set(["site_id", "metrics", "date_range", "dimensions", "filters", "order_by", "include", "pagination"]);
    if (Object.keys(input).some((key) => !rootKeys.has(key))) {
        throw new StatsAPIError("Request body contains unknown keys");
    }
    if (typeof input.site_id !== "string" || !input.site_id) throw new StatsAPIError("site_id is required");
    if (!Array.isArray(input.metrics) || input.metrics.length === 0 || input.metrics.some((metric) => !METRICS.includes(metric as Metric))) {
        throw new StatsAPIError("metrics must contain supported metric names");
    }
    if (new Set(input.metrics).size !== input.metrics.length) {
        throw new StatsAPIError("metrics must be unique");
    }
    const dimensions = input.dimensions ?? [];
    if (!Array.isArray(dimensions) || dimensions.some((dimension) => typeof dimension !== "string" || (!Object.hasOwn(SCALAR_DIMENSIONS, dimension) && !TIME_DIMENSIONS.includes(dimension as TimeDimension) && !/^event:props:[A-Za-z0-9_.-]{1,64}$/.test(dimension)))) {
        throw new StatsAPIError("At most one supported dimension can be queried");
    }
    if (new Set(dimensions).size !== dimensions.length) {
        throw new StatsAPIError("dimensions must be unique");
    }
    if (dimensions.length > 1) {
        throw new StatsAPIError("At most one supported dimension can be queried");
    }
    const filters = input.filters ?? [];
    if (!Array.isArray(filters) || filters.some((filter) => !Array.isArray(filter) || filter.length !== 3 || !["is", "is_not", "contains", "contains_not"].includes(filter[0]) || typeof filter[1] !== "string" || !Object.hasOwn(SCALAR_DIMENSIONS, filter[1]) || !Array.isArray(filter[2]) || filter[2].length === 0 || filter[2].length > 100 || filter[2].some((item) => typeof item !== "string"))) {
        throw new StatsAPIError("filters contain an unsupported operator, dimension, or value list");
    }
    const metrics = input.metrics as Metric[];
    if (input.pagination !== undefined && (!input.pagination || typeof input.pagination !== "object" || Array.isArray(input.pagination))) {
        throw new StatsAPIError("pagination must be an object");
    }
    const pagination = (input.pagination ?? {}) as Record<string, unknown>;
    if (Object.keys(pagination).some((key) => !["limit", "offset"].includes(key))) {
        throw new StatsAPIError("pagination contains unknown keys");
    }
    const limit = pagination.limit === undefined ? 10_000 : Number(pagination.limit);
    const offset = pagination.offset === undefined ? 0 : Number(pagination.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000 || !Number.isInteger(offset) || offset < 0) {
        throw new StatsAPIError("pagination limit or offset is invalid");
    }
    if (input.include !== undefined && (!input.include || typeof input.include !== "object" || Array.isArray(input.include))) {
        throw new StatsAPIError("include must be an object");
    }
    const include = (input.include ?? {}) as StatsQuery["include"];
    if (Object.keys(include).some((key) => !["imports", "time_labels", "total_rows"].includes(key))) {
        throw new StatsAPIError("include contains unknown keys");
    }
    if ([include.imports, include.time_labels, include.total_rows].some((option) => option !== undefined && typeof option !== "boolean")) {
        throw new StatsAPIError("include options must be booleans");
    }
    if (include.time_labels && !dimensions.some((dimension) => TIME_DIMENSIONS.includes(dimension as TimeDimension))) {
        throw new StatsAPIError("time_labels requires a time dimension");
    }
    const orderBy = (input.order_by ?? []) as StatsQuery["order_by"];
    if (!Array.isArray(orderBy) || orderBy.length > 1 || orderBy.some((item) => !Array.isArray(item) || item.length !== 2 || ![...metrics, ...dimensions].includes(item[0]) || !["asc", "desc"].includes(item[1]))) {
        throw new StatsAPIError("order_by contains an unknown field or direction");
    }
    const range = parseDateRange(input.date_range, reportingTimezone);
    return { site_id: input.site_id, metrics, date_range: range.input, dimensions: dimensions as Dimension[], filters: filters as StatsQuery["filters"], order_by: orderBy, include, pagination: { limit, offset }, start: range.start, end: range.end, normalizedRange: range.normalized, reportingTimezone };
}

function toR2Filters(filters: StatsQuery["filters"]): R2StatsFilter[] {
    return filters.map(([operator, dimension, values]) => ({
        operator,
        field: SCALAR_DIMENSIONS[dimension].filter as keyof SearchFilters,
        values,
    }));
}

function r2BreakdownOptions(query: StatsQuery & { start: Date; end: Date; reportingTimezone: string }): R2BreakdownOptions {
    const dimension = query.dimensions[0];
    const isTimeDimension = dimension !== undefined && TIME_DIMENSIONS.includes(dimension as TimeDimension);
    const orderBy = query.order_by[0] ?? [
        isTimeDimension ? dimension : query.metrics[0],
        isTimeDimension ? "asc" : "desc",
    ];
    const [field, direction] = orderBy as [Metric | Dimension, "asc" | "desc"];
    const clause: R2OrderClause = field === dimension
        ? { field: "dimension", direction }
        : { field: field as R2OrderField, direction };
    return {
        orderBy: [clause],
        pagination: query.pagination,
        count: query.include.total_rows,
    };
}

function resolveTimeDimension(dimension: TimeDimension, start: Date, end: Date): Exclude<TimeDimension, "time"> {
    if (dimension !== "time") return dimension;
    const duration = end.getTime() - start.getTime();
    if (duration <= 2 * 24 * 60 * 60 * 1000) return "time:hour";
    if (duration <= 40 * 24 * 60 * 60 * 1000) return "time:day";
    if (duration <= 52 * 7 * 24 * 60 * 60 * 1000) return "time:week";
    return "time:month";
}

function formatTimeLabel(value: string, dimension: TimeDimension, start: Date, end: Date): string {
    const resolved = resolveTimeDimension(dimension, start, end);
    if (resolved === "time:week") {
        const bucket = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
        const rangeStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
        if (bucket < rangeStart) return rangeStart.toISOString().slice(0, 10);
    }
    return resolved === "time:hour"
        ? value.replace("T", " ").slice(0, 19)
        : value.slice(0, 10);
}

export function getTimeBuckets(dimension: TimeDimension, start: Date, end: Date, reportingTimezone: string): SessionTimeBucket[] {
    const resolved = resolveTimeDimension(dimension, start, end);
    let cursor = dayjs(start).tz(reportingTimezone);
    if (resolved === "time:hour") cursor = cursor.startOf("hour");
    if (resolved === "time:day") cursor = cursor.startOf("day");
    if (resolved === "time:week") {
        cursor = cursor.startOf("day").subtract((cursor.day() + 6) % 7, "day");
    }
    if (resolved === "time:month") cursor = cursor.startOf("month");
    const buckets: SessionTimeBucket[] = [];
    let first = true;
    while (cursor.valueOf() < end.getTime() && buckets.length < 10_000) {
        const bucketStart = new Date(Math.max(cursor.valueOf(), start.getTime()));
        const label = resolved === "time:week" && first && cursor.valueOf() < start.getTime()
            ? dayjs(start).tz(reportingTimezone).format("YYYY-MM-DD")
            : resolved === "time:hour"
              ? cursor.format("YYYY-MM-DD HH:mm:ss")
              : cursor.format("YYYY-MM-DD");
        // dayjs().tz().add() on a Date-sourced instance returns the same
        // instant in this environment, so advance from the epoch millis
        // instead of chaining .add() on the tz-aware cursor.
        let next = dayjs(cursor.valueOf()).tz(reportingTimezone);
        if (resolved === "time:hour") next = dayjs(cursor.valueOf() + 60 * 60 * 1000).tz(reportingTimezone);
        if (resolved === "time:day") next = next.add(1, "day").startOf("day");
        if (resolved === "time:week") next = next.add(1, "week").startOf("day");
        if (resolved === "time:month") next = next.add(1, "month").startOf("month");
        buckets.push({
            label,
            start: bucketStart,
            end: new Date(Math.min(next.valueOf(), end.getTime())),
        });
        cursor = next;
        first = false;
    }
    if (cursor.valueOf() < end.getTime()) throw new StatsAPIError("Requested time range has too many labels");
    return buckets;
}

function getTimeLabels(dimension: TimeDimension, start: Date, end: Date, reportingTimezone: string): string[] {
    return [...new Set(
        getTimeBuckets(dimension, start, end, reportingTimezone).map(({ label }) => label),
    )];
}

function metricValue(metric: Metric, basic: BasicMetrics, sessions?: SessionMetrics): number | null {
    if (metric === "visitors" || metric === "pageviews" || metric === "events") return basic[metric];
    if (!sessions) throw new StatsAPIError("R2 SQL is required for session metrics");
    if (metric === "visits") return sessions.visits;
    if (metric === "views_per_visit") return sessions.visits ? sessions.views / sessions.visits : 0;
    if (metric === "bounce_rate") return sessions.visits ? (sessions.bounces / sessions.visits) * 100 : 0;
    return sessions.averageVisitDuration === null ? 0 : Math.round(sessions.averageVisitDuration);
}

export async function executeStatsQuery(sessions: R2SQLAPI | undefined, input: unknown, reportingTimezone = "Etc/UTC") {
    const query = parseQuery(input, reportingTimezone);
    if (!sessions) throw new StatsAPIError("Basin SQL is not configured");
    const needsSessions = query.metrics.some((metric) => !["visitors", "pageviews", "events"].includes(metric));
    if (needsSessions && !sessions) throw new StatsAPIError("R2 SQL is required for session metrics");
    const dimension = query.dimensions[0];
    if (needsSessions && dimension === "event:hostname") {
        throw new StatsAPIError("event:hostname requires event:page when querying session metrics");
    }
    if (dimension?.startsWith("event:props:") && !query.filters?.some((f) => f[0] === "is" && f[1] === "event:name" && Array.isArray(f[2]) && f[2].length === 1)) {
        throw new StatsAPIError("event:props breakdown requires an event:name is-filter naming exactly one event");
    }
    const resolvedDimension = dimension && TIME_DIMENSIONS.includes(dimension as TimeDimension)
        ? resolveTimeDimension(dimension as TimeDimension, query.start, query.end)
        : dimension;
    const timeBuckets = sessions && resolvedDimension?.startsWith("time:")
        ? getTimeBuckets(
              resolvedDimension as TimeDimension,
              query.start,
              query.end,
              reportingTimezone,
          )
        : undefined;
    if (needsSessions && timeBuckets && timeBuckets.length > 500) {
        throw new StatsAPIError("R2 SQL session time dimensions support at most 500 buckets");
    }
    const sessionMetrics = needsSessions && !dimension
        ? await sessions!.getSessionMetrics(query.site_id, query.start, query.end, toR2Filters(query.filters))
        : undefined;
    const sessionBreakdown = needsSessions && dimension
        ? await sessions!.getSessionBreakdown(
              query.site_id,
              query.start,
              query.end,
               toR2Filters(query.filters),
              resolvedDimension as SessionDimension,
              timeBuckets,
              r2BreakdownOptions(query),
           )
        : undefined;
    let basicResult: {
        rows: Array<{ dimension?: string; sessionMetrics?: SessionMetrics } & BasicMetrics>;
        totalRows: number;
        serverPaged?: boolean;
    };
    if (sessionBreakdown) {
        basicResult = {
            rows: sessionBreakdown.rows.map((row) => ({
                ...row,
                dimension: resolvedDimension?.startsWith("time:")
                    ? formatTimeLabel(
                          row.dimension,
                          resolvedDimension as TimeDimension,
                          query.start,
                          query.end,
                      )
                    : row.dimension,
                pageviews: row.views,
                sessionMetrics: row,
            })),
            totalRows: sessionBreakdown.totalRows ?? sessionBreakdown.rows.length,
            serverPaged: true,
        };
    } else if (sessionMetrics) {
        basicResult = {
            rows: [{ visitors: sessionMetrics.visitors, pageviews: sessionMetrics.views, events: sessionMetrics.events }],
            totalRows: 1,
        };
    } else if (sessions) {
        const breakdown = await sessions.getBasicMetrics(
            query.site_id,
            query.start,
            query.end,
            toR2Filters(query.filters),
            resolvedDimension as SessionDimension | undefined,
            timeBuckets,
            r2BreakdownOptions(query),
        );
        basicResult = {
            rows: breakdown.rows.map((row) => ({
                ...row,
                pageviews: row.views,
                dimension: row.dimension && resolvedDimension?.startsWith("time:")
                    ? formatTimeLabel(row.dimension, resolvedDimension as TimeDimension, query.start, query.end)
                    : row.dimension,
            })),
            totalRows: breakdown.totalRows ?? breakdown.rows.length,
            serverPaged: Boolean(resolvedDimension),
        };
    } else {
        throw new StatsAPIError("Basin SQL is not configured");
    }
    const basicRows = basicResult.rows;
    let results = basicRows.map((row) => {
        const rowSessionMetrics = "sessionMetrics" in row
            ? row.sessionMetrics as SessionMetrics
            : sessionMetrics;
        return {
            dimensions: query.dimensions.length ? [row.dimension || ""] : [],
            metrics: query.metrics.map((metric) =>
                metricValue(metric, row, rowSessionMetrics),
            ),
        };
    });
    const timeDimension = query.dimensions.find((dimension) => TIME_DIMENSIONS.includes(dimension as TimeDimension)) as TimeDimension | undefined;
    const orderBy = query.order_by[0] ?? [timeDimension || query.metrics[0], timeDimension ? "asc" : "desc"];
    if (!basicResult.serverPaged) {
        const fieldIndex = query.metrics.indexOf(orderBy[0] as Metric);
        results.sort((a, b) => {
            const left = fieldIndex >= 0 ? a.metrics[fieldIndex] : a.dimensions[0];
            const right = fieldIndex >= 0 ? b.metrics[fieldIndex] : b.dimensions[0];
            const comparison = left === right ? 0 : (left ?? 0) < (right ?? 0) ? -1 : 1;
            if (comparison !== 0) return orderBy[1] === "asc" ? comparison : -comparison;
            const leftDimension = String(a.dimensions[0] || "");
            const rightDimension = String(b.dimensions[0] || "");
            return leftDimension === rightDimension ? 0 : leftDimension < rightDimension ? -1 : 1;
        });
        results = results.slice(query.pagination.offset, query.pagination.offset + query.pagination.limit);
    }
    const meta: { total_rows?: number; time_labels?: string[]; imports_included?: boolean } = {};
    if (query.include.imports) meta.imports_included = false;
    if (query.include.total_rows) meta.total_rows = basicResult.totalRows;
    if (query.include.time_labels && timeDimension) {
        meta.time_labels = getTimeLabels(timeDimension, query.start, query.end, query.reportingTimezone);
    }
    const normalizedOrderBy = query.order_by.length ? query.order_by : [orderBy];
    return {
        results,
        meta,
        query: {
            site_id: query.site_id,
            metrics: query.metrics,
            date_range: query.normalizedRange,
            filters: query.filters,
            dimensions: query.dimensions.map((dimension) => dimension === "time" ? resolveTimeDimension(dimension, query.start, query.end) : dimension),
            order_by: normalizedOrderBy.map(([field, direction]) => [
                field === "time" ? resolveTimeDimension("time", query.start, query.end) : field,
                direction,
            ]),
            include: query.include,
            pagination: query.pagination,
        },
    };
}
