export type CountRow =
  | [string | [string, string], number, number]
  | [string | [string, string], number];

export interface BreakdownResponse {
  countsByProperty: CountRow[];
  page: number;
}

export interface StatsMetrics {
  views?: number;
  visitors?: number;
  visits?: number;
  bounceRate?: number;
  averageVisitDuration?: number | null;
  hasSufficientBounceData?: boolean;
}

export interface StatsResponse extends StatsMetrics {
  previous?: StatsMetrics;
}

export interface TimeseriesResponse {
  chartData: { date: string; views: number; visitors: number; bounceRate: number }[];
  intervalType: "DAY" | "HOUR";
}

export interface RealtimeStats {
  currentVisitors: number;
  visitors30m: number;
  pageviews30m: number;
  pageviewsPerMinute: number[];
  topPages: { pathname: string; views: number }[];
  topReferrers: { referrer: string; visitors: number }[];
  topCountries: { country: string; visitors: number }[];
}

export interface Goal {
  id: string;
  site_id: string;
  name: string;
  type: string;
  value: string;
  conversions: number;
  totalConversions: number;
  conversionRate: number;
  currency: string | null;
  totalRevenue: number | null;
  averageRevenue: number | null;
}

async function request<T>(path: string, method: string, body?: Record<string, string>): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: Record<string, string>) {
  return request<T>(path, "POST", body);
}

async function get<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const res = await fetch(`${path}?${query.toString()}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface DashboardQuery {
  site: string;
  interval: string;
  timezone: string;
  filters: Record<string, string>;
  nonce?: number;
  page?: number;
}

const DASH = "/api/dashboard";

function params(q: DashboardQuery, extra?: Record<string, string>) {
  return {
    site: q.site,
    interval: q.interval,
    timezone: q.timezone,
    page: q.page,
    ...q.filters,
    ...extra,
  };
}

export const dashboardApi = {
  sites: () =>
    get<{ sites: string[]; details: { domain: string; timezone: string }[] }>(`${DASH}/sites`, {}),
  createSite: (domain: string, timezone?: string) =>
    post<{ domain: string; timezone: string; trackerId: string }>(
      `${DASH}/sites`,
      timezone ? { domain, timezone } : { domain },
    ),
  updateSite: (domain: string, timezone: string) =>
    request<{ domain: string; timezone: string }>(
      `${DASH}/sites/${encodeURIComponent(domain)}`,
      "PATCH",
      { timezone },
    ),
  deleteSite: (domain: string) =>
    request<{ deleted: boolean }>(`${DASH}/sites/${encodeURIComponent(domain)}`, "DELETE"),
  stats: (q: DashboardQuery) => get<StatsResponse>(`${DASH}/stats`, params(q)),
  timeseries: (q: DashboardQuery) => get<TimeseriesResponse>(`${DASH}/timeseries`, params(q)),
  goals: (q: DashboardQuery) => get<{ goals: Goal[] }>(`${DASH}/goals`, params(q)),
  props: (q: DashboardQuery, event: string, key: string) =>
    get<BreakdownResponse>(`${DASH}/props`, params(q, { event, key })),
  breakdown: (card: BreakdownCard, q: DashboardQuery) =>
    get<BreakdownResponse>(`${DASH}/${card}`, params(q)),
};

export type BreakdownCard =
  | "paths"
  | "entry-pages"
  | "exit-pages"
  | "referrer"
  | "events"
  | "browser"
  | "browserversion"
  | "country"
  | "device"
  | "utm-source"
  | "utm-medium"
  | "utm-campaign"
  | "utm-term"
  | "utm-content";
