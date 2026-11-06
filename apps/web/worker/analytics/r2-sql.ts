import type { SearchFilters } from "../lib/types";

export interface SessionMetrics {
  views: number;
  events: number;
  visitors: number;
  visits: number;
  bounces: number;
  averageVisitDuration: number | null;
}

export interface SessionMetricsRow extends SessionMetrics {
  dimension: string;
}

export interface BasicMetricsRow {
  dimension?: string;
  views: number;
  events: number;
  visitors: number;
}

export type SessionDimension =
  | "event:page"
  | `event:props:${string}`
  | "event:hostname"
  | "event:name"
  | "visit:referrer"
  | "visit:source"
  | "visit:utm_source"
  | "visit:utm_medium"
  | "visit:utm_campaign"
  | "visit:utm_term"
  | "visit:utm_content"
  | "visit:country"
  | "visit:browser"
  | "visit:browser_version"
  | "visit:device_type"
  | "visit:device_model"
  | "visit:entry_page"
  | "visit:exit_page"
  | "time:hour"
  | "time:day"
  | "time:week"
  | "time:month";

// Event (row-level) dimension columns, usable with getBasicMetrics.
const EVENT_DIMENSIONS: Partial<Record<SessionDimension, string>> = {
  "event:page": "pathname",
  "event:hostname": "hostname",
  "event:name": "event_name",
};

// Visit (session) dimension columns, attributed from the session's first
// pageview (Plausible visit semantics) via getSessionBreakdown.
const VISIT_DIMENSIONS: Partial<Record<SessionDimension, string>> = {
  "event:page": "pathname",
  "event:hostname": "hostname",
  "visit:referrer": "referrer",
  "visit:source": "visit:source",
  "visit:utm_source": "utm_source",
  "visit:utm_medium": "utm_medium",
  "visit:utm_campaign": "utm_campaign",
  "visit:utm_term": "utm_term",
  "visit:utm_content": "utm_content",
  "visit:country": "country",
  "visit:browser": "browser",
  "visit:browser_version": "browser_version",
  "visit:device_type": "device_type",
  "visit:device_model": "device_model",
  "visit:entry_page": "pathname",
  "visit:exit_page": "pathname",
};

export interface R2StatsFilter {
  field: keyof SearchFilters;
  operator: "is" | "is_not" | "contains" | "contains_not";
  values: string[];
}

export interface SessionTimeBucket {
  label: string;
  start: Date;
  end: Date;
}

export interface R2Pagination {
  limit: number;
  offset: number;
}

export type R2OrderField =
  | "dimension"
  | "visitors"
  | "pageviews"
  | "events"
  | "visits"
  | "views_per_visit"
  | "bounce_rate"
  | "visit_duration";

export interface R2OrderClause {
  field: R2OrderField;
  direction: "asc" | "desc";
}

export interface R2BreakdownOptions {
  orderBy?: R2OrderClause[];
  pagination?: R2Pagination;
  count?: boolean;
}

type R2SQLResponse<Row> = {
  success?: boolean;
  errors?: Array<{ code: number; message: string }>;
  data?: Row[];
  rows?: Row[];
  result?: Row[] | { data?: Row[]; rows?: Row[] };
};

const FILTER_COLUMNS: Partial<Record<keyof SearchFilters, string>> = {
  host: "hostname",
  path: "pathname",
  name: "event_name",
  referrer: "referrer",
  browserName: "browser",
  browserVersion: "browser_version",
  country: "country",
  deviceModel: "device_model",
  deviceType: "device_type",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmTerm: "utm_term",
  utmContent: "utm_content",
};

const FILTER_COLUMN_LIST = Object.values(FILTER_COLUMNS);

// Canonical event columns shared by the live table and the optional import
// table; kept in sync with apps/web/pipelines/events.schema.json.
const DURABLE_EVENT_COLUMNS = [
  "schema_version",
  "event_id",
  "received_at",
  "site_id",
  "event_type",
  "event_name",
  "event_properties",
  "url",
  "hostname",
  "pathname",
  "referrer",
  "interactive",
  "revenue_amount",
  "revenue_currency",
  "engagement_time",
  "scroll_depth",
  "country",
  "region",
  "city",
  "browser",
  "browser_version",
  "operating_system",
  "operating_system_version",
  "device_type",
  "device_model",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "visitor_id",
] as const;

const KEEP_DEDUPLICATED_ROW = "(COALESCE(event_id, '') = '' OR duplicate_rank = 1)";

function deduplicatedEventsCte(
  table: string,
  siteId: string,
  start: string,
  end: string,
  columns: readonly string[],
  cteName = "deduplicated_events",
): string {
  const coreColumns = ["event_id", "received_at", "visitor_id", "event_type"];
  const selectColumns = [...coreColumns];
  for (const column of columns) {
    if (!selectColumns.includes(column)) {
      selectColumns.push(column);
    }
  }
  return `
        ${cteName} AS (
            SELECT ${selectColumns.join(", ")},
                ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(event_id, '')
                    ORDER BY received_at, visitor_id, event_type, event_id
                ) AS duplicate_rank
            FROM ${table}
            WHERE site_id = ${sqlString(siteId)}
                AND received_at >= ${start}
                AND received_at < ${end}
        )`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function validateTableName(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error("R2 SQL table must use the namespace.table format");
  }
  return table;
}

function filtersToPredicate(filters: SearchFilters | R2StatsFilter[]): string {
  const normalized: R2StatsFilter[] = Array.isArray(filters)
    ? filters
    : Object.entries(filters).flatMap(([field, value]) =>
        typeof value === "string"
          ? [
              {
                field: field as keyof SearchFilters,
                operator: "is" as const,
                values: [value],
              },
            ]
          : [],
      );
  const predicates = normalized
    .map(({ field, operator, values }) => {
      const column = FILTER_COLUMNS[field];
      if (!column || values.length === 0) return "";
      if (operator === "contains" || operator === "contains_not") {
        const comparisons = values.map(
          (value) =>
            `strpos(${column}, ${sqlString(value)}) ${operator === "contains" ? "> 0" : "= 0"}`,
        );
        return `(${comparisons.join(operator === "contains" ? " OR " : " AND ")})`;
      }
      if (values.length === 1) {
        return `${column} ${operator === "is" ? "=" : "<>"} ${sqlString(values[0])}`;
      }
      return `${column} ${operator === "is" ? "IN" : "NOT IN"} (${values.map(sqlString).join(", ")})`;
    })
    .filter(Boolean)
    .join(" AND ");
  return predicates || "TRUE";
}

function basicOrderExpression(field: R2OrderField): string {
  switch (field) {
    case "dimension":
      return "dimension";
    case "visitors":
      return "visitors";
    case "pageviews":
      return "views";
    case "events":
      return "events";
    default:
      throw new Error(`Unsupported R2 order field for basic metrics: ${field}`);
  }
}

function sessionOrderExpression(field: R2OrderField): string {
  switch (field) {
    case "dimension":
      return "dimension";
    case "visitors":
      return "visitors";
    case "pageviews":
      return "views";
    case "events":
      return "events";
    case "visits":
      return "visits";
    case "views_per_visit":
      return "CASE WHEN visits > 0 THEN views / visits ELSE 0 END";
    case "bounce_rate":
      return "CASE WHEN visits > 0 THEN bounces / visits * 100 ELSE 0 END";
    case "visit_duration":
      return "COALESCE(average_visit_duration, 0)";
  }
}

function buildOrderBy(
  orderBy: R2OrderClause[] | undefined,
  expression: (field: R2OrderField) => string,
): string {
  const clauses = (orderBy ?? []).map(
    ({ field, direction }) => `${expression(field)} ${direction.toUpperCase()}`,
  );
  const lastField = orderBy?.[orderBy.length - 1]?.field;
  if (lastField !== "dimension") {
    clauses.push("dimension ASC");
  }
  return `ORDER BY ${clauses.join(", ")}`;
}

function getRows<Row>(payload: R2SQLResponse<Row>): Row[] {
  if (
    payload.success === true &&
    payload.result &&
    !Array.isArray(payload.result) &&
    Array.isArray(payload.result.rows)
  ) {
    return payload.result.rows;
  }
  throw new Error("R2 SQL returned an invalid response");
}

export class R2SQLAPI {
  private readonly endpoint: string;
  private readonly table: string;
  private readonly warehouse: string;

  constructor(
    accountId: string,
    bucket: string,
    private readonly apiToken: string,
    table: string,
    private readonly fetcher: typeof fetch = fetch,
    importTable?: string,
    private readonly waitUntil?: (promise: Promise<unknown>) => void,
  ) {
    this.endpoint =
      "https://api.sql.cloudflarestorage.com/api/v1/accounts/" +
      `${encodeURIComponent(accountId)}/basin-sql/query/${encodeURIComponent(bucket)}`;
    this.warehouse = `${accountId}_${bucket}`;
    const main = validateTableName(table);
    const imported = importTable ? validateTableName(importTable) : undefined;
    this.table = imported
      ? `(SELECT ${DURABLE_EVENT_COLUMNS.join(", ")} FROM ${main}
                UNION ALL
                SELECT ${DURABLE_EVENT_COLUMNS.join(", ")} FROM ${imported})`
      : main;
  }

  async query<Row>(query: string, rangeEndMs?: number): Promise<Row[]> {
    const cacheKey = await this.cacheKey(query);
    const cache =
      cacheKey && typeof globalThis.caches !== "undefined" && "default" in globalThis.caches
        ? (globalThis.caches.default as Cache)
        : undefined;
    const hit = cache && cacheKey ? await cache.match(cacheKey) : undefined;
    if (hit) {
      return (await hit.json()) as Row[];
    }
    const response = await this.fetcher.call(globalThis, this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ warehouse: this.warehouse, query }),
    });
    if (!response.ok) {
      throw new Error(`R2 SQL query failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as R2SQLResponse<Row>;
    if (payload.success === false) {
      const errors = payload.errors?.map(({ code, message }) => `${code}: ${message}`).join(", ");
      throw new Error(`R2 SQL query failed: ${errors || "unknown error"}`);
    }
    const rows = getRows(payload);
    if (cache && cacheKey) {
      const ttl =
        rangeEndMs !== undefined && Date.now() - rangeEndMs >= 60 * 60 * 1000 ? 24 * 60 * 60 : 60;
      const cached = new Response(JSON.stringify(rows), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${ttl}`,
        },
      });
      this.ctxWaitUntil(cache.put(cacheKey, cached));
    }
    return rows;
  }

  private ctxWaitUntil(promise: Promise<unknown>): void {
    if (this.waitUntil) {
      try {
        this.waitUntil(promise);
        return;
      } catch {
        // fall through to fire-and-forget
      }
    }
    try {
      promise.catch(() => {});
    } catch {
      // no execution context in unit tests; fire and forget
    }
  }

  private async cacheKey(query: string): Promise<Request | undefined> {
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${this.warehouse}:${query}`),
      );
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      return new Request(`https://basin-cache.noomers/${encodeURIComponent(this.table)}/${hex}`);
    } catch {
      return undefined;
    }
  }

  async getSessionMetrics(
    siteId: string,
    startDate: Date,
    endDate: Date,
    filters: SearchFilters | R2StatsFilter[] = {},
  ): Promise<SessionMetrics> {
    const lookbackDate = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
    );
    // Visitor IDs rotate at UTC midnight, so reading through that boundary
    // closes every session that began before the interval ended.
    const lastIntervalInstant = new Date(endDate.getTime() - 1);
    const lookaheadDate = new Date(
      Date.UTC(
        lastIntervalInstant.getUTCFullYear(),
        lastIntervalInstant.getUTCMonth(),
        lastIntervalInstant.getUTCDate() + 1,
      ),
    );
    const start = sqlString(startDate.toISOString());
    const end = sqlString(endDate.toISOString());
    const lookback = sqlString(lookbackDate.toISOString());
    const lookahead = sqlString(lookaheadDate.toISOString());
    const filterPredicate = filtersToPredicate(filters);
    const query = `
            WITH ${deduplicatedEventsCte(this.table, siteId, lookback, lookahead, [
              "interactive",
              "engagement_time",
              ...FILTER_COLUMN_LIST,
            ])},
            all_events AS (
                SELECT
                    event_id,
                    visitor_id,
                    event_type,
                    interactive,
                    engagement_time,
                    CASE WHEN ${filterPredicate}
                        AND TRY_CAST(received_at AS TIMESTAMP) >= TRY_CAST(${start} AS TIMESTAMP)
                        AND TRY_CAST(received_at AS TIMESTAMP) < TRY_CAST(${end} AS TIMESTAMP)
                        THEN 1 ELSE 0 END AS matches_filter,
                    TRY_CAST(received_at AS TIMESTAMP) AS event_ts
                FROM deduplicated_events
                WHERE ${KEEP_DEDUPLICATED_ROW}
            ),
            session_events AS (
                SELECT *
                FROM all_events
                WHERE visitor_id <> '' AND event_ts IS NOT NULL
            ),
            with_previous AS (
                SELECT *,
                    LAG(event_ts) OVER (
                        PARTITION BY visitor_id
                        ORDER BY event_ts, event_id
                    ) AS previous_ts
                FROM session_events
            ),
            with_boundaries AS (
                SELECT *,
                    CASE
                        WHEN previous_ts IS NULL
                            OR to_unixtime(event_ts) - to_unixtime(previous_ts) >= 1800
                        THEN 1 ELSE 0
                    END AS starts_session
                FROM with_previous
            ),
            numbered AS (
                SELECT *,
                    SUM(starts_session) OVER (
                        PARTITION BY visitor_id
                        ORDER BY event_ts, event_id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS session_number
                FROM with_boundaries
            ),
            sessions AS (
                SELECT
                    visitor_id,
                    session_number,
                    MIN(CASE WHEN event_type = 'pageview' THEN event_ts END) AS visit_start,
                    SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
                    SUM(CASE WHEN event_type <> 'engagement' AND interactive THEN 1 ELSE 0 END) AS interactive_events,
                    SUM(matches_filter) AS matching_events,
                    to_unixtime(MAX(CASE WHEN event_type <> 'engagement' THEN event_ts END))
                        - to_unixtime(MIN(CASE WHEN event_type <> 'engagement' THEN event_ts END)) AS duration_seconds
                FROM numbered
                GROUP BY visitor_id, session_number
            ),
            interval_events AS (
                SELECT
                    SUM(CASE WHEN event_type = 'pageview' AND matches_filter = 1 THEN 1 ELSE 0 END) AS views,
                    SUM(CASE WHEN event_type <> 'engagement' AND matches_filter = 1 THEN 1 ELSE 0 END) AS events,
                    COUNT(DISTINCT CASE WHEN event_type = 'pageview' AND matches_filter = 1 AND visitor_id <> '' THEN visitor_id END) AS visitors
                FROM all_events
                WHERE event_ts >= TRY_CAST(${start} AS TIMESTAMP)
                    AND event_ts < TRY_CAST(${end} AS TIMESTAMP)
            ),
            interval_sessions AS (
                SELECT
                    COUNT(*) AS visits,
                    SUM(CASE WHEN interactive_events <= 1 THEN 1 ELSE 0 END) AS bounces,
                    CASE
                        WHEN SUM(duration_seconds) > 0
                        THEN SUM(duration_seconds) / COUNT(*)
                        ELSE NULL
                    END AS average_visit_duration
                FROM sessions
                WHERE visit_start >= TRY_CAST(${start} AS TIMESTAMP)
                    AND visit_start < TRY_CAST(${end} AS TIMESTAMP)
                    AND pageviews > 0
                    AND matching_events > 0
            )
            SELECT
                interval_events.views,
                interval_events.events,
                interval_events.visitors,
                interval_sessions.visits,
                interval_sessions.bounces,
                interval_sessions.average_visit_duration
            FROM interval_events CROSS JOIN interval_sessions`;

    type Row = {
      views?: string | number | null;
      events?: string | number | null;
      visitors?: string | number | null;
      visits?: string | number | null;
      bounces?: string | number | null;
      average_visit_duration?: string | number | null;
    };
    const [row = {}] = await this.query<Row>(query, endDate.getTime());

    return {
      views: Number(row.views || 0),
      events: Number(row.events || 0),
      visitors: Number(row.visitors || 0),
      visits: Number(row.visits || 0),
      bounces: Number(row.bounces || 0),
      averageVisitDuration:
        row.average_visit_duration === null || row.average_visit_duration === undefined
          ? null
          : Number(row.average_visit_duration),
    };
  }

  async getBasicMetrics(
    siteId: string,
    startDate: Date,
    endDate: Date,
    filters: SearchFilters | R2StatsFilter[] = {},
    dimension?: SessionDimension,
    timeBuckets?: SessionTimeBucket[],
    options: R2BreakdownOptions = {},
  ): Promise<{ rows: BasicMetricsRow[]; totalRows?: number }> {
    const start = sqlString(startDate.toISOString());
    const end = sqlString(endDate.toISOString());
    const filterPredicate = filtersToPredicate(filters);
    let eventDimension = EVENT_DIMENSIONS[dimension || "time:day"];
    let propsExpression: string | undefined;
    if (dimension?.startsWith("event:props:")) {
      const key = dimension.slice("event:props:".length);
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
        throw new Error(`Invalid event property key: ${key}`);
      }
      propsExpression = `json_get_str(event_properties, ${sqlString(key)})`;
      eventDimension = "event_properties";
    }
    const dimensionExpression = dimension
      ? propsExpression ||
        eventDimension ||
        `CASE ${
          timeBuckets
            ?.map(
              (bucket) =>
                `WHEN event_ts >= TRY_CAST(${sqlString(bucket.start.toISOString())} AS TIMESTAMP)` +
                ` AND event_ts < TRY_CAST(${sqlString(bucket.end.toISOString())} AS TIMESTAMP)` +
                ` THEN ${sqlString(bucket.label)}`,
            )
            .join(" ") || ""
        } ELSE NULL END`
      : undefined;
    const eventsCte = `
            ${deduplicatedEventsCte(this.table, siteId, start, end, [
              "pathname",
              "hostname",
              "event_name",
              ...(eventDimension ? [eventDimension] : []),
            ])},
            events AS (
                SELECT
                    visitor_id,
                    event_type,
                    event_name,
                    pathname,
                    hostname,
                    ${eventDimension && !["pathname", "hostname", "event_name"].includes(eventDimension) ? eventDimension + "," : ""}
                    TRY_CAST(received_at AS TIMESTAMP) AS event_ts
                FROM deduplicated_events
                WHERE ${KEEP_DEDUPLICATED_ROW}
                    AND ${filterPredicate}
            )`;
    const aggregateSelect = `
            SELECT
                ${dimensionExpression ? `${dimensionExpression} AS dimension,` : ""}
                COUNT(DISTINCT CASE WHEN visitor_id <> '' THEN visitor_id END) AS visitors,
                SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS views,
                SUM(CASE WHEN event_type <> 'engagement' THEN 1 ELSE 0 END) AS events
            FROM events
            WHERE event_ts >= TRY_CAST(${start} AS TIMESTAMP)
                AND event_ts < TRY_CAST(${end} AS TIMESTAMP)
            ${dimensionExpression ? "GROUP BY dimension" : ""}`;
    const { orderBy, pagination, count } = options;
    const usePagination = Boolean(dimensionExpression && pagination);

    type Row = {
      dimension?: string | null;
      views?: string | number | null;
      events?: string | number | null;
      visitors?: string | number | null;
      total_rows?: string | number | null;
    };

    let rows: Row[];
    if (!usePagination) {
      rows = await this.query<Row>(
        `WITH ${eventsCte}${aggregateSelect}${dimensionExpression ? " LIMIT 10001" : ""}`,
        endDate.getTime(),
      );
      if (rows.length > 10_000) {
        throw new Error("R2 SQL dimension breakdown exceeds 10,000 rows");
      }
    } else {
      const orderSql = buildOrderBy(orderBy, basicOrderExpression);
      const totalSelect = count ? ", total_rows" : "";
      const totalProject = count ? "COUNT(*) OVER () AS total_rows," : "";
      rows = await this.query<Row>(
        `
                WITH ${eventsCte},
                grouped AS (${aggregateSelect}),
                paged AS (
                    SELECT *,
                        ${totalProject}
                        ROW_NUMBER() OVER (${orderSql}) AS row_num
                    FROM grouped
                )
                SELECT ${dimensionExpression ? "dimension," : ""} visitors, views, events${totalSelect}
                FROM paged
                WHERE row_num > ${pagination!.offset}
                    AND row_num <= ${pagination!.offset + pagination!.limit}
                ORDER BY row_num`,
        endDate.getTime(),
      );
      if (count && rows.length === 0) {
        const [countRow = {}] = await this.query<{
          total?: string | number | null;
        }>(`
                    WITH ${eventsCte},
                    grouped AS (${aggregateSelect})
                    SELECT COUNT(*) AS total FROM grouped`);
        return {
          rows: [],
          totalRows: Number(countRow.total || 0),
        };
      }
    }
    const mapped = rows.map((row) => ({
      ...(dimension ? { dimension: String(row.dimension || "") } : {}),
      views: Number(row.views || 0),
      events: Number(row.events || 0),
      visitors: Number(row.visitors || 0),
    }));
    return {
      rows: mapped,
      totalRows: count && rows.length > 0 ? Number(rows[0].total_rows || 0) : undefined,
    };
  }

  async getGoalBreakdown(
    siteId: string,
    startDate: Date,
    endDate: Date,
    filters: SearchFilters | R2StatsFilter[],
    goals: Array<{
      type: "event" | "pageview";
      value: string;
      customProps: Record<string, string>;
      currency?: string | null;
    }>,
  ): Promise<{
    visitors: number;
    goals: Array<{
      uniques: number;
      total: number;
      revenue: { total: number; count: number } | null;
    }>;
    anyUniques: number;
    anyRevenue: { total: number; count: number } | null;
  }> {
    if (goals.length > 20) {
      throw new Error(`At most 20 goals per breakdown (got ${goals.length})`);
    }
    const start = sqlString(startDate.toISOString());
    const end = sqlString(endDate.toISOString());
    const usesProps = goals.some((goal) => Object.keys(goal.customProps).length > 0);
    const usesRevenue = goals.some((goal) => goal.currency);
    const predicates = goals.map((goal) => {
      const parts = [
        goal.type === "pageview"
          ? `event_type = 'pageview' AND pathname = ${sqlString(goal.value)}`
          : `event_type <> 'engagement' AND event_name = ${sqlString(goal.value)}`,
      ];
      for (const [key, value] of Object.entries(goal.customProps)) {
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
          throw new Error(`Invalid goal property key: ${key}`);
        }
        parts.push(`json_get_str(event_properties, ${sqlString(key)}) = ${sqlString(value)}`);
      }
      return `(${parts.join(" AND ")})`;
    });
    const goalColumns = goals
      .map((goal, i) => {
        const base = `,COUNT(DISTINCT CASE WHEN ${predicates[i]} THEN visitor_id END) AS u_${i}
                    ,SUM(CASE WHEN ${predicates[i]} THEN 1 ELSE 0 END) AS t_${i}`;
        if (!goal.currency) return base;
        const revCond = `${predicates[i]} AND revenue_currency = ${sqlString(goal.currency)} AND TRY_CAST(revenue_amount AS DOUBLE) IS NOT NULL`;
        return `${base}
                    ,SUM(CASE WHEN ${revCond} THEN TRY_CAST(revenue_amount AS DOUBLE) ELSE 0 END) AS r_${i}
                    ,SUM(CASE WHEN ${revCond} THEN 1 ELSE 0 END) AS rc_${i}`;
      })
      .join("\n");
    const anyColumn =
      goals.length > 0
        ? `,COUNT(DISTINCT CASE WHEN ${predicates.join(" OR ")} THEN visitor_id END) AS any_uniques`
        : "";
    const revenuePreds = goals
      .map((goal, i) =>
        goal.currency
          ? `(${predicates[i]} AND revenue_currency = ${sqlString(goal.currency)} AND TRY_CAST(revenue_amount AS DOUBLE) IS NOT NULL)`
          : null,
      )
      .filter((p): p is string => p !== null);
    const anyRevColumn = revenuePreds.length
      ? `,SUM(CASE WHEN ${revenuePreds.join(" OR ")} THEN TRY_CAST(revenue_amount AS DOUBLE) ELSE 0 END) AS any_rev_total
            ,SUM(CASE WHEN ${revenuePreds.join(" OR ")} THEN 1 ELSE 0 END) AS any_rev_count`
      : "";
    const rows = await this.query<Record<string, string | number | null>>(
      `WITH ${deduplicatedEventsCte(this.table, siteId, start, end, [
        "pathname",
        "event_name",
        ...(usesProps ? ["event_properties"] : []),
        ...(usesRevenue ? ["revenue_amount", "revenue_currency"] : []),
        ...FILTER_COLUMN_LIST,
      ])}
            SELECT COUNT(DISTINCT visitor_id) AS visitors${goalColumns}${anyColumn}${anyRevColumn}
            FROM deduplicated_events
            WHERE ${KEEP_DEDUPLICATED_ROW}
                AND visitor_id <> ''
                AND ${filtersToPredicate(filters)}
                AND TRY_CAST(received_at AS TIMESTAMP) >= TRY_CAST(${start} AS TIMESTAMP)
                AND TRY_CAST(received_at AS TIMESTAMP) < TRY_CAST(${end} AS TIMESTAMP)`,
      endDate.getTime(),
    );
    const row = rows[0] || {};
    const anyRev =
      revenuePreds.length > 0
        ? {
            total: Number(row.any_rev_total || 0),
            count: Number(row.any_rev_count || 0),
          }
        : null;
    return {
      visitors: Number(row.visitors || 0),
      goals: goals.map((goal, i) => ({
        uniques: Number(row[`u_${i}`] || 0),
        total: Number(row[`t_${i}`] || 0),
        revenue: goal.currency
          ? { total: Number(row[`r_${i}`] || 0), count: Number(row[`rc_${i}`] || 0) }
          : null,
      })),
      anyUniques: Number(row.any_uniques || 0),
      anyRevenue: anyRev,
    };
  }

  async getSessionBreakdown(
    siteId: string,
    startDate: Date,
    endDate: Date,
    filters: SearchFilters | R2StatsFilter[],
    dimension: SessionDimension,
    timeBuckets?: SessionTimeBucket[],
    options: R2BreakdownOptions = {},
  ): Promise<{ rows: SessionMetricsRow[]; totalRows?: number }> {
    const lookbackDate = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
    );
    const lastIntervalInstant = new Date(endDate.getTime() - 1);
    const lookaheadDate = new Date(
      Date.UTC(
        lastIntervalInstant.getUTCFullYear(),
        lastIntervalInstant.getUTCMonth(),
        lastIntervalInstant.getUTCDate() + 1,
      ),
    );
    const start = sqlString(startDate.toISOString());
    const end = sqlString(endDate.toISOString());
    const filterPredicate = filtersToPredicate(filters);
    if (dimension === "event:name") {
      throw new Error("event:name does not support session metrics");
    }
    let eventDimension = VISIT_DIMENSIONS[dimension];
    let eventDimensionSql = eventDimension;
    let dimensionColumns: string[] = eventDimension ? [eventDimension] : [];
    if (dimension === "visit:source") {
      // utm_source wins, else referrer hostname sans www., else empty
      eventDimensionSql = `CASE
                WHEN utm_source <> '' THEN utm_source
                WHEN referrer <> '' THEN regexp_replace(split_part(referrer, '/', 3), '^www\\.', '')
                ELSE '' END`;
      dimensionColumns = ["utm_source", "referrer"];
    } else if (dimension.startsWith("event:props:")) {
      const key = dimension.slice("event:props:".length);
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
        throw new Error(`Invalid event property key: ${key}`);
      }
      eventDimensionSql = `json_get_str(event_properties, ${sqlString(key)})`;
      eventDimension = eventDimensionSql;
      dimensionColumns = ["event_properties", "event_name"];
    }
    const visitDimension = dimension.startsWith("visit:");
    const timeUnit = dimension.startsWith("time:") ? dimension.slice("time:".length) : undefined;
    if (!eventDimension && !dimension.startsWith("event:props:") && !timeUnit) {
      throw new Error(`${dimension} does not support session metrics`);
    }
    const bucketExpression = (column: string) =>
      timeBuckets
        ? `CASE ${timeBuckets
            .map(
              (bucket) =>
                `WHEN ${column} >= TRY_CAST(${sqlString(bucket.start.toISOString())} AS TIMESTAMP)` +
                ` AND ${column} < TRY_CAST(${sqlString(bucket.end.toISOString())} AS TIMESTAMP)` +
                ` THEN ${sqlString(bucket.label)}`,
            )
            .join(" ")} ELSE NULL END`
        : `date_trunc(${sqlString(timeUnit || "day")}, ${column})`;
    const eventDimensionExpression = eventDimension
      ? "dimension_value"
      : bucketExpression("event_ts");
    const sessionDimensionExpression = eventDimension || bucketExpression("visit_start");
    const ctes = `
            WITH ${deduplicatedEventsCte(
              this.table,
              siteId,
              sqlString(lookbackDate.toISOString()),
              sqlString(lookaheadDate.toISOString()),
              [
                "interactive",
                "engagement_time",
                "pathname",
                "hostname",
                "event_name",
                ...dimensionColumns,
                ...FILTER_COLUMN_LIST,
              ],
            )},
            all_events AS (
                SELECT
                    event_id,
                    visitor_id,
                    event_type,
                    interactive,
                    engagement_time,
                    pathname,
                    hostname,
                    CASE WHEN ${filterPredicate}
                        AND TRY_CAST(received_at AS TIMESTAMP) >= TRY_CAST(${start} AS TIMESTAMP)
                        AND TRY_CAST(received_at AS TIMESTAMP) < TRY_CAST(${end} AS TIMESTAMP)
                        THEN 1 ELSE 0 END AS matches_filter,
                    ${eventDimensionSql ? `${eventDimensionSql} AS dimension_value,` : ""}
                    TRY_CAST(received_at AS TIMESTAMP) AS event_ts
                FROM deduplicated_events
                WHERE ${KEEP_DEDUPLICATED_ROW}
            ),
            session_events AS (
                SELECT * FROM all_events
                WHERE visitor_id <> '' AND event_ts IS NOT NULL
            ),
            with_previous AS (
                SELECT *, LAG(event_ts) OVER (
                    PARTITION BY visitor_id ORDER BY event_ts, event_id
                ) AS previous_ts
                FROM session_events
            ),
            with_boundaries AS (
                SELECT *, CASE
                    WHEN previous_ts IS NULL
                        OR to_unixtime(event_ts) - to_unixtime(previous_ts) >= 1800
                    THEN 1 ELSE 0
                END AS starts_session
                FROM with_previous
            ),
            numbered AS (
                SELECT *, SUM(starts_session) OVER (
                    PARTITION BY visitor_id ORDER BY event_ts, event_id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS session_number
                FROM with_boundaries
            ),
            sessions AS (
                SELECT
                    visitor_id,
                    session_number,
                    MIN(CASE WHEN event_type = 'pageview' THEN event_ts END) AS visit_start,
                    FIRST_VALUE(${eventDimension ? "dimension_value" : "pathname"} ORDER BY event_ts, event_id) FILTER (WHERE event_type = 'pageview') AS entry_page,
                    ${
                      dimension === "visit:exit_page"
                        ? `FIRST_VALUE(dimension_value ORDER BY event_ts DESC, event_id DESC) FILTER (WHERE event_type = 'pageview') AS exit_page,`
                        : ""
                    }
                    SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
                    SUM(CASE WHEN event_type <> 'engagement' AND interactive THEN 1 ELSE 0 END) AS interactive_events,
                    SUM(matches_filter) AS matching_events,
                    to_unixtime(MAX(CASE WHEN event_type <> 'engagement' THEN event_ts END))
                        - to_unixtime(MIN(CASE WHEN event_type <> 'engagement' THEN event_ts END)) AS duration_seconds
                FROM numbered
                GROUP BY visitor_id, session_number
            ),
            session_dimensions AS (
                ${
                  eventDimension
                    ? `SELECT visitor_id, session_number, ${dimension === "visit:exit_page" ? "exit_page" : "entry_page"} AS dimension
                       FROM sessions WHERE matching_events > 0`
                    : `SELECT visitor_id, session_number, ${sessionDimensionExpression} AS dimension
                       FROM sessions WHERE matching_events > 0`
                }
            ),
            event_metrics AS (
                ${
                  visitDimension
                    ? `SELECT
                        session_dimensions.dimension,
                        SUM(sessions.pageviews) AS views,
                        COUNT(*) AS events,
                        COUNT(DISTINCT sessions.visitor_id) AS visitors
                    FROM sessions
                    JOIN session_dimensions
                        ON sessions.visitor_id = session_dimensions.visitor_id
                        AND sessions.session_number = session_dimensions.session_number
                    WHERE sessions.visit_start >= TRY_CAST(${start} AS TIMESTAMP)
                        AND sessions.visit_start < TRY_CAST(${end} AS TIMESTAMP)
                        AND sessions.pageviews > 0
                    GROUP BY session_dimensions.dimension`
                    : `SELECT
                        ${eventDimensionExpression} AS dimension,
                        SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS views,
                        SUM(CASE WHEN event_type <> 'engagement' THEN 1 ELSE 0 END) AS events,
                        COUNT(DISTINCT CASE WHEN visitor_id <> '' THEN visitor_id END) AS visitors
                    FROM all_events
                    WHERE event_ts >= TRY_CAST(${start} AS TIMESTAMP)
                        AND event_ts < TRY_CAST(${end} AS TIMESTAMP)
                        AND matches_filter = 1
                    GROUP BY dimension`
                }
            ),
            session_metrics AS (
                SELECT
                    session_dimensions.dimension,
                    COUNT(*) AS visits,
                    SUM(CASE WHEN sessions.interactive_events <= 1 THEN 1 ELSE 0 END) AS bounces,
                    CASE WHEN SUM(sessions.duration_seconds) > 0
                        THEN SUM(sessions.duration_seconds) / COUNT(*)
                        ELSE NULL
                    END AS average_visit_duration
                FROM sessions
                JOIN session_dimensions
                    ON sessions.visitor_id = session_dimensions.visitor_id
                    AND sessions.session_number = session_dimensions.session_number
                WHERE sessions.visit_start >= TRY_CAST(${start} AS TIMESTAMP)
                    AND sessions.visit_start < TRY_CAST(${end} AS TIMESTAMP)
                    AND sessions.pageviews > 0
                GROUP BY session_dimensions.dimension
            )`;
    const finalSelect = `
            SELECT
                event_metrics.dimension,
                event_metrics.views,
                event_metrics.events,
                event_metrics.visitors,
                COALESCE(session_metrics.visits, 0) AS visits,
                COALESCE(session_metrics.bounces, 0) AS bounces,
                session_metrics.average_visit_duration
            FROM event_metrics
            LEFT JOIN session_metrics
                ON event_metrics.dimension = session_metrics.dimension`;
    const { orderBy, pagination, count } = options;

    type Row = {
      dimension?: string | null;
      views?: string | number | null;
      events?: string | number | null;
      visitors?: string | number | null;
      visits?: string | number | null;
      bounces?: string | number | null;
      average_visit_duration?: string | number | null;
      total_rows?: string | number | null;
    };
    let rows: Row[];
    if (!pagination) {
      rows = await this.query<Row>(`${ctes}${finalSelect} LIMIT 10001`, endDate.getTime());
      if (rows.length > 10_000) {
        throw new Error("R2 SQL dimension breakdown exceeds 10,000 rows");
      }
    } else {
      const orderSql = buildOrderBy(orderBy, sessionOrderExpression);
      const totalSelect = count ? ", total_rows" : "";
      const totalProject = count ? "COUNT(*) OVER () AS total_rows," : "";
      rows = await this.query<Row>(
        `
                ${ctes},
                grouped AS (${finalSelect}),
                paged AS (
                    SELECT *,
                        ${totalProject}
                        ROW_NUMBER() OVER (${orderSql}) AS row_num
                    FROM grouped
                )
                SELECT dimension, views, events, visitors, visits, bounces, average_visit_duration${totalSelect}
                FROM paged
                WHERE row_num > ${pagination.offset}
                    AND row_num <= ${pagination.offset + pagination.limit}
                ORDER BY row_num`,
        endDate.getTime(),
      );
      if (count && rows.length === 0) {
        const [countRow = {}] = await this.query<{
          total?: string | number | null;
        }>(`
                    ${ctes},
                    grouped AS (${finalSelect})
                    SELECT COUNT(*) AS total FROM grouped`);
        return {
          rows: [],
          totalRows: Number(countRow.total || 0),
        };
      }
    }
    const mapped = rows.map((row) => ({
      dimension: String(row.dimension || ""),
      views: Number(row.views || 0),
      events: Number(row.events || 0),
      visitors: Number(row.visitors || 0),
      visits: Number(row.visits || 0),
      bounces: Number(row.bounces || 0),
      averageVisitDuration:
        row.average_visit_duration == null ? null : Number(row.average_visit_duration),
    }));
    return {
      rows: mapped,
      totalRows: count && rows.length > 0 ? Number(rows[0].total_rows || 0) : undefined,
    };
  }
}
