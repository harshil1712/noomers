import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod/mini";
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  ChartLegend,
  Dialog,
  Empty,
  Grid,
  Pagination,
  Select,
  Surface,
  Table,
  Tabs,
  Text,
  Tooltip,
} from "@cloudflare/kumo";
import { ArrowSquareOut, Globe, X } from "@phosphor-icons/react";
import { useDocumentTitle } from "../../lib/use-document-title";
import { themeColor, useIsDark } from "../../lib/use-is-dark";
import { refreshSites, useSites as useSharedSites } from "../../lib/use-sites";
import { AddSiteDialog } from "../../components/dashboard/add-site-dialog";
import { TrackerSnippetBlock } from "../../components/dashboard/tracker-snippet-block";
import { NotOwnerNotice } from "../../components/dashboard/not-owner-notice";
import {
  dashboardApi,
  type BreakdownCard,
  type BreakdownResponse,
  type DashboardQuery,
  type RealtimeStats,
  type TimeseriesResponse,
} from "../../lib/dashboard-api";

const DashboardTrend = lazy(() =>
  import("../../components/dashboard/analytics-charts").then((m) => ({
    default: m.DashboardTrend,
  })),
);

const INTERVALS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "day", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "Month to date" },
  { value: "6mo", label: "Last 6 months" },
  { value: "12mo", label: "Last 12 months" },
];

const FILTER_LABELS = {
  path: "Path",
  name: "Event",
  referrer: "Referrer",
  deviceType: "Device",
  country: "Country",
  browserName: "Browser",
  browserVersion: "Browser version",
  utmSource: "UTM source",
  utmMedium: "UTM medium",
  utmCampaign: "UTM campaign",
  utmTerm: "UTM term",
  utmContent: "UTM content",
};
type FilterKey = keyof typeof FILTER_LABELS;
const FILTER_KEYS = Object.keys(FILTER_LABELS) as FilterKey[];

const CAMPAIGN_DIMS: { card: BreakdownCard; label: string; filter: FilterKey }[] = [
  { card: "utm-source", label: "UTM source", filter: "utmSource" },
  { card: "utm-medium", label: "UTM medium", filter: "utmMedium" },
  { card: "utm-campaign", label: "UTM campaign", filter: "utmCampaign" },
  { card: "utm-term", label: "UTM term", filter: "utmTerm" },
  { card: "utm-content", label: "UTM content", filter: "utmContent" },
];

const PANELS: {
  title: string;
  tabs: {
    card: BreakdownCard | "goals" | "campaigns";
    label: string;
    filter?: FilterKey;
  }[];
}[] = [
  {
    title: "Sources",
    tabs: [
      { card: "referrer", label: "Referrers", filter: "referrer" },
      { card: "campaigns", label: "Campaigns" },
    ],
  },
  {
    title: "Pages",
    tabs: [
      { card: "paths", label: "Top pages", filter: "path" },
      { card: "entry-pages", label: "Entry pages" },
      { card: "exit-pages", label: "Exit pages" },
    ],
  },
  { title: "Locations", tabs: [{ card: "country", label: "Countries", filter: "country" }] },
  {
    title: "Devices",
    tabs: [
      { card: "browser", label: "Browsers", filter: "browserName" },
      { card: "browserversion", label: "Versions", filter: "browserVersion" },
      { card: "device", label: "Devices", filter: "deviceType" },
    ],
  },
  { title: "Goals", tabs: [{ card: "goals", label: "Conversions" }] },
  {
    title: "Events",
    tabs: [{ card: "events", label: "Events", filter: "name" }],
  },
];

interface SearchParams {
  site?: string;
  interval?: string;
  tab?: string;
  path?: string;
  name?: string;
  referrer?: string;
  deviceType?: string;
  country?: string;
  browserName?: string;
  browserVersion?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

const searchSchema = z.object(
  Object.fromEntries(
    ["site", "interval", "tab", ...FILTER_KEYS].map((key) => [key, z.optional(z.string())]),
  ),
);

export const Route = createFileRoute("/_authed/dashboard")({
  validateSearch: (search: z.input<typeof searchSchema>): SearchParams => {
    const parsed = searchSchema.safeParse(search);
    return parsed.success ? parsed.data : {};
  },
  component: Dashboard,
});

function useRealtime(siteId: string) {
  const [stats, setStats] = useState<RealtimeStats | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  useEffect(() => {
    if (!siteId) return;
    setStats(null);
    setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/realtime/${siteId}`);
    ws.onopen = () => setStatus("live");
    const disconnect = () => {
      setStats(null);
      setStatus("offline");
    };
    ws.onclose = disconnect;
    ws.onerror = disconnect;
    ws.onmessage = (event) => {
      try {
        setStats(JSON.parse(event.data as string) as RealtimeStats);
      } catch {
        // ignore malformed frames
      }
    };
    return () => {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    };
  }, [siteId]);
  return { stats, status };
}

/* ---------- dashboard ---------- */
function Dashboard() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isDark = useIsDark();
  const { sites: siteList, error: sitesError, forbidden } = useSharedSites();
  const sites = useMemo(() => siteList?.map((s) => s.domain) ?? null, [siteList]);
  const [nonce, setNonce] = useState(0);
  const [failures, setFailures] = useState<Set<string>>(new Set());

  const site = search.site ?? "";
  useEffect(() => {
    if (sites && !site) {
      void navigate({ to: "/", replace: true });
    }
  }, [sites, site, navigate]);

  const interval = search.interval || "7d";
  const timezone = siteList?.find((s) => s.domain === (search.site ?? ""))?.timezone ?? "UTC";
  const tab = search.tab === "realtime" ? "realtime" : "overview";
  useDocumentTitle(
    site ? `${site} · ${tab === "realtime" ? "Realtime" : "Overview"}` : "Dashboard",
  );
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = search[key];
      if (value) out[key] = value;
    }
    return out;
  }, [search]);

  const setSearch = (patch: Partial<SearchParams>) => {
    void navigate({ search: (prev: SearchParams) => ({ ...prev, ...patch }) });
  };
  const clearFilters = () => {
    const empty: Partial<SearchParams> = {};
    for (const key of FILTER_KEYS) empty[key] = undefined;
    setSearch(empty);
  };

  const reportError = (key: string, failed: boolean) => {
    setFailures((prev) => {
      if (prev.has(key) === failed) return prev;
      const next = new Set(prev);
      if (failed) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const basinDown = failures.size >= 3;
  const retryHistorical = () => {
    setFailures(new Set());
    setNonce((n) => n + 1);
  };

  const query: DashboardQuery = { site, interval, filters, nonce };
  const registered = sites?.includes(site);
  const realtime = useRealtime(registered ? site : "");
  if (site && sites && !sitesError && !registered) {
    return (
      <Empty
        title="Site not found"
        description="This domain is no longer in your list of tracked sites."
        contents={<Button onClick={() => void navigate({ to: "/" })}>All sites</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* page header */}
      <div className="flex flex-col gap-3">
        <Breadcrumbs size="sm">
          <Breadcrumbs.Link href="/">Sites</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{site || "Dashboard"}</Breadcrumbs.Current>
        </Breadcrumbs>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <Text variant="heading1" as="h1" DANGEROUS_className="min-w-0 break-all">
              {site || "Dashboard"}
            </Text>
            {site && (
              <Tooltip
                content={`Open ${site}`}
                render={
                  <Button
                    variant="ghost"
                    icon={<ArrowSquareOut size={16} />}
                    aria-label={`Open ${site}`}
                    onClick={() => window.open(`https://${site}`, "_blank")}
                  />
                }
              />
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Tabs
              variant="segmented"
              tabs={[
                { value: "overview", label: "Overview" },
                { value: "realtime", label: "Realtime" },
              ]}
              selectedValue={tab}
              onValueChange={(v) => setSearch({ tab: v as string })}
            />
            {tab !== "realtime" && (
              <Select
                label="Reporting period"
                hideLabel
                value={interval}
                onValueChange={(v) => {
                  if (v !== undefined && v !== null) setSearch({ interval: v as string });
                }}
                renderValue={(v) => INTERVALS.find((i) => i.value === v)?.label ?? v}
              >
                {INTERVALS.map((option) => (
                  <Select.Option key={option.value} value={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
            )}
            <Dialog.Root>
              <Dialog.Trigger render={<Button variant="secondary">Tracking code</Button>} />
              <Dialog size="lg" className="p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <Dialog.Title>Tracking code</Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    render={(props) => (
                      <Button
                        {...props}
                        variant="ghost"
                        size="sm"
                        icon={<X size={16} />}
                        aria-label="Close"
                      />
                    )}
                  />
                </div>
                <Dialog.Description>
                  Paste this into the {"<head>"} of every page on {site || "example.com"}.
                </Dialog.Description>
                <div className="mt-3">
                  <TrackerSnippetBlock domain={site || "example.com"} />
                </div>
              </Dialog>
            </Dialog.Root>
          </div>
        </div>
      </div>

      {tab === "overview" && Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_KEYS.filter((key) => filters[key]).map((key) => (
            <Badge key={key} variant="primary">
              {FILTER_LABELS[key]}: {filters[key]}
              <Tooltip
                content={`Remove ${FILTER_LABELS[key].toLowerCase()} filter`}
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={<X size={12} />}
                    aria-label={`Remove ${FILTER_LABELS[key].toLowerCase()} filter`}
                    onClick={() => setSearch({ [key]: undefined })}
                  />
                }
              />
            </Badge>
          ))}
          <Button variant="ghost" onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      )}

      {basinDown && tab === "overview" && (
        <Banner
          variant="error"
          icon={<Globe weight="fill" />}
          title="Historical data is unavailable"
          description="Try loading the reports again."
          action={
            <Button variant="secondary" onClick={retryHistorical}>
              Retry
            </Button>
          }
        />
      )}

      {forbidden ? (
        <NotOwnerNotice />
      ) : sitesError ? (
        <Surface className="rounded-xl p-8 text-center">
          <Text variant="heading3" as="h2">
            Couldn&apos;t load your sites
          </Text>
          <p className="mt-2 text-sm text-kumo-subtle">
            The dashboard API didn&apos;t respond. Check that you&apos;re signed in and try again.
          </p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => void refreshSites()}>Retry</Button>
          </div>
        </Surface>
      ) : sites === null ? (
        <DashboardSkeleton />
      ) : sites !== null && sites.length === 0 ? (
        <Empty
          title="No sites yet"
          description="Add a site to start tracking it."
          contents={<AddSiteDialog />}
        />
      ) : !site ? (
        <DashboardSkeleton />
      ) : tab === "realtime" ? (
        <RealtimeTab realtime={realtime} />
      ) : (
        <OverviewTab
          query={query}
          site={site}
          timezone={timezone}
          isDark={isDark}
          realtime={realtime}
          onFilter={setSearch}
          onError={reportError}
          quiet={basinDown}
        />
      )}
    </div>
  );
}

/* ---------- overview ---------- */
function OverviewTab({
  query,
  site,
  timezone,
  isDark,
  realtime,
  onFilter,
  onError,
  quiet,
}: {
  query: DashboardQuery;
  site: string;
  timezone: string;
  isDark: boolean;
  realtime: ReturnType<typeof useRealtime>;
  onFilter: (patch: Partial<SearchParams>) => void;
  onError: (key: string, failed: boolean) => void;
  quiet: boolean;
}) {
  const [metric, setMetric] = useState<"visitors" | "views">("visitors");
  return (
    <>
      <KpiStrip
        query={query}
        realtime={realtime}
        onError={onError}
        quiet={quiet}
        metric={metric}
        onSelectMetric={setMetric}
        interval={query.interval}
      />
      <TimeseriesPanel
        query={query}
        isDark={isDark}
        timezone={timezone}
        onError={onError}
        quiet={quiet}
        metric={metric}
      />
      <Grid variant="2up" gap="base">
        {PANELS.map((panel) => (
          <BreakdownPanel
            key={panel.title}
            panel={panel}
            query={query}
            onFilter={onFilter}
            site={site}
            onError={onError}
            quiet={quiet}
          />
        ))}
      </Grid>
    </>
  );
}

/* ---------- KPI strip ---------- */
const INTERVAL_LABEL = {
  "24h": "previous 24 hours",
  day: "previous day",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
  month: "previous month",
  "6mo": "previous 6 months",
  "12mo": "previous 12 months",
};

function DeltaBadge({
  current,
  previous,
  interval,
  invert,
}: {
  current?: number | null;
  previous?: number | null;
  interval: string;
  invert?: boolean;
}) {
  if (current === undefined || current === null || !previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(pct) || pct === 0) return null;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <Tooltip
      content={`vs. ${interval in INTERVAL_LABEL ? INTERVAL_LABEL[interval as keyof typeof INTERVAL_LABEL] : "previous period"}`}
      render={
        <Badge variant={good ? "success" : "destructive"}>
          {up ? "↑" : "↓"} {Math.abs(pct)}%
        </Badge>
      }
    />
  );
}

function KpiStrip({
  query,
  realtime,
  onError,
  quiet,
  metric,
  onSelectMetric,
  interval,
}: {
  query: DashboardQuery;
  realtime: ReturnType<typeof useRealtime>;
  onError?: (key: string, failed: boolean) => void;
  quiet?: boolean;
  metric: "visitors" | "views";
  onSelectMetric: (m: "visitors" | "views") => void;
  interval: string;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardApi.stats>> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setData(null);
    dashboardApi
      .stats(query, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) {
          setData(d);
          onError?.("stats", false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          onError?.("stats", true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [query.site, query.interval, query.filters, query.nonce, attempt]);

  const fmt = Intl.NumberFormat("en", { notation: "compact" });
  const duration = (s: number) => {
    const r = Math.round(s);
    return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${r % 60}s`;
  };

  if (error) {
    return quiet ? (
      <div className="h-24 rounded-xl bg-kumo-recessed" aria-hidden="true" />
    ) : (
      <PanelError message="Couldn’t load the summary." onRetry={() => setAttempt((n) => n + 1)} />
    );
  }

  const prev = data?.previous;
  const tiles: {
    label: string;
    value: string;
    live?: boolean;
    delta?: React.ReactNode;
    toggle?: "visitors" | "views";
  }[] = [
    {
      label: "Live visitors",
      value:
        realtime.stats?.currentVisitors !== undefined
          ? fmt.format(realtime.stats.currentVisitors)
          : "—",
      live: true,
    },
    {
      label: "Visitors",
      value: data?.visitors !== undefined ? fmt.format(data.visitors) : "—",
      delta: <DeltaBadge current={data?.visitors} previous={prev?.visitors} interval={interval} />,
      toggle: "visitors",
    },
    {
      label: "Pageviews",
      value: data?.views !== undefined ? fmt.format(data.views) : "—",
      delta: <DeltaBadge current={data?.views} previous={prev?.views} interval={interval} />,
      toggle: "views",
    },
    {
      label: "Bounce rate",
      value: data?.bounceRate !== undefined ? `${Math.round(data.bounceRate * 100)}%` : "—",
      delta: (
        <DeltaBadge
          current={data?.bounceRate}
          previous={prev?.bounceRate}
          interval={interval}
          invert
        />
      ),
    },
    {
      label: "Visit duration",
      value:
        data?.averageVisitDuration !== undefined && data?.averageVisitDuration !== null
          ? duration(data.averageVisitDuration)
          : "—",
      delta: (
        <DeltaBadge
          current={data?.averageVisitDuration}
          previous={prev?.averageVisitDuration}
          interval={interval}
        />
      ),
    },
    {
      label: "Views / visit",
      value:
        data?.views !== undefined && data?.visits !== undefined && data.visits > 0
          ? (data.views / data.visits).toFixed(1)
          : "—",
    },
  ];

  return (
    <Surface className="overflow-hidden rounded-xl">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t, i) => {
          const selected = t.toggle === metric;
          const inner = (
            <>
              <span className="mono-label">{t.label}</span>
              <div className="mt-1 flex items-center gap-2">
                {t.live && realtime.status === "live" && (
                  <span className="live-dot" aria-hidden="true" title={realtime.status} />
                )}
                <span className="whitespace-nowrap tabular-nums">
                  <Text variant="heading1" as="h2">
                    {t.value}
                  </Text>
                </span>
              </div>
              <div className="mt-1 min-h-6">
                {t.live && realtime.status !== "live" ? (
                  <Text variant="secondary" size="sm">
                    {realtime.status === "offline" ? "Offline" : "Connecting…"}
                  </Text>
                ) : (
                  t.delta
                )}
              </div>
            </>
          );
          const cls = `flex flex-col justify-start border-kumo-hairline border-t-2 px-5 py-4 ${
            selected ? "border-t-kumo-brand bg-kumo-tint" : "border-t-transparent"
          } ${i % 2 === 1 ? "" : "border-r"} sm:border-r ${i === 5 ? "sm:border-r-0" : ""}`;
          return t.toggle ? (
            <button
              key={t.label}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectMetric(t.toggle!)}
              className={`text-left ${cls}`}
            >
              {inner}
            </button>
          ) : (
            <div key={t.label} className={cls}>
              {inner}
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

/* ---------- timeseries ---------- */
function TimeseriesPanel({
  query,
  isDark,
  timezone,
  onError,
  quiet,
  metric,
}: {
  query: DashboardQuery;
  isDark: boolean;
  timezone: string;
  onError?: (key: string, failed: boolean) => void;
  quiet?: boolean;
  metric: "visitors" | "views";
}) {
  const [rows, setRows] = useState<TimeseriesResponse["chartData"] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setRows(null);
    dashboardApi
      .timeseries(query, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        onError?.("timeseries", false);
        setRows(res.chartData);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          onError?.("timeseries", true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [query.site, query.interval, query.filters, query.nonce, attempt]);

  const brand = themeColor("--color-kumo-brand");
  const secondary = themeColor("--color-kumo-series-2");
  const muted = themeColor("--color-kumo-subtle");
  const data = useMemo(() => {
    if (!rows) return null;
    const series = (key: "visitors" | "views", name: string, color: string) => ({
      name,
      color,
      data: rows.map((row) => [Date.parse(row.date), row[key]] as [number, number]),
    });
    return metric === "visitors"
      ? [series("visitors", "Visitors", brand), series("views", "Pageviews", muted)]
      : [series("views", "Pageviews", secondary), series("visitors", "Visitors", muted)];
  }, [rows, metric, brand, secondary, muted]);

  return (
    <Surface className="min-w-0 overflow-hidden rounded-xl p-4">
      {error ? (
        quiet ? (
          <div className="h-[300px] rounded-lg bg-kumo-recessed" aria-hidden="true" />
        ) : (
          <PanelError message="Couldn’t load the chart." onRetry={() => setAttempt((n) => n + 1)} />
        )
      ) : !data ? (
        <div className="skeleton h-[300px] rounded-lg" />
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <ChartLegend.SmallItem
                name="Visitors"
                value=""
                color={metric === "visitors" ? brand : muted}
              />
              <ChartLegend.SmallItem
                name="Pageviews"
                value=""
                color={metric === "views" ? secondary : muted}
              />
            </div>
            <span className="mono-label">{timezone}</span>
          </div>
          <Suspense fallback={<div className="skeleton h-[300px] rounded-lg" />}>
            <DashboardTrend data={data} isDark={isDark} />
          </Suspense>
        </>
      )}
    </Surface>
  );
}

/* ---------- breakdown panels ---------- */
function BreakdownPanel({
  panel,
  query,
  onFilter,
  site,
  onError,
  quiet,
}: {
  panel: (typeof PANELS)[number];
  query: DashboardQuery;
  onFilter: (patch: Partial<SearchParams>) => void;
  site: string;
  onError?: (key: string, failed: boolean) => void;
  quiet?: boolean;
}) {
  const [tab, setTab] = useState(panel.tabs[0].card);
  const active = panel.tabs.find((t) => t.card === tab) ?? panel.tabs[0];
  return (
    <Surface className="flex h-full flex-col rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Text variant="heading3" as="h2">
          {panel.title}
        </Text>
        {panel.tabs.length > 1 && (
          <Tabs
            variant="underline"
            tabs={panel.tabs.map((t) => ({ value: t.card, label: t.label }))}
            selectedValue={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
          />
        )}
      </div>
      <BreakdownTable
        card={active.card}
        filter={active.filter}
        query={query}
        onFilter={onFilter}
        site={site}
        onError={onError}
        quiet={quiet}
      />
    </Surface>
  );
}

function BreakdownTable({
  card,
  filter,
  query,
  onFilter,
  site,
  onError,
  quiet,
}: {
  card: BreakdownCard | "goals" | "campaigns";
  filter?: FilterKey;
  query: DashboardQuery;
  onFilter: (patch: Partial<SearchParams>) => void;
  site: string;
  onError?: (key: string, failed: boolean) => void;
  quiet?: boolean;
}) {
  const [dim, setDim] = useState(CAMPAIGN_DIMS[0]);
  const isCampaigns = card === "campaigns";
  const realCard = (isCampaigns ? dim.card : card) as BreakdownCard;
  const realFilter = isCampaigns ? dim.filter : filter;
  const errKey = `bd:${realCard}`;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BreakdownResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const isGoals = card === "goals";
  const [goalRevenue, setGoalRevenue] = useState<Record<string, string>>({});
  const hasRevenue = isGoals && Object.values(goalRevenue).some((v) => v !== "-");

  useEffect(() => setPage(1), [realCard, query.site, query.interval, query.filters]);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setData(null);
    const finish = (fn: () => void) => {
      if (!controller.signal.aborted) fn();
    };
    if (isGoals) {
      dashboardApi
        .goals(query, controller.signal)
        .then((r) =>
          finish(() => {
            setData({
              countsByProperty: r.goals.map((g) => [
                g.name,
                g.conversions,
                Math.round(g.conversionRate),
              ]),
              page: 1,
              hasNextPage: false,
            });
            setGoalRevenue(
              Object.fromEntries(
                r.goals.map((g) => [
                  g.name,
                  g.currency
                    ? new Intl.NumberFormat("en", {
                        style: "currency",
                        currency: g.currency,
                      }).format(g.totalRevenue ?? 0)
                    : "-",
                ]),
              ),
            );
            onError?.(errKey, false);
          }),
        )
        .catch(() =>
          finish(() => {
            setError(true);
            onError?.(errKey, true);
          }),
        );
    } else {
      dashboardApi
        .breakdown(realCard, { ...query, page }, controller.signal)
        .then((d) =>
          finish(() => {
            setData(d);
            onError?.(errKey, false);
          }),
        )
        .catch(() =>
          finish(() => {
            setError(true);
            onError?.(errKey, true);
          }),
        );
    }
    return () => {
      controller.abort();
    };
  }, [realCard, isGoals, query.site, query.interval, query.filters, page, query.nonce, attempt]);

  const dimSelect = isCampaigns ? (
    <div className="mb-1 mt-3">
      <Select
        label="Campaign dimension"
        hideLabel
        value={dim.card}
        onValueChange={(v) => {
          const next = CAMPAIGN_DIMS.find((d) => d.card === v);
          if (next) setDim(next);
        }}
        renderValue={() => dim.label}
      >
        {CAMPAIGN_DIMS.map((d) => (
          <Select.Option key={d.card} value={d.card}>
            {d.label}
          </Select.Option>
        ))}
      </Select>
    </div>
  ) : null;

  if (error) {
    return quiet ? (
      <MutedRows />
    ) : (
      <>
        {dimSelect}
        <PanelError message="Couldn’t load this report." onRetry={() => setAttempt((n) => n + 1)} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        {dimSelect}
        <div className="mt-3 space-y-2">
          {[0.92, 0.8, 0.68, 0.56, 0.44, 0.32].map((w) => (
            <div key={w} className="skeleton h-5 rounded" style={{ width: `${w * 100}%` }} />
          ))}
        </div>
      </>
    );
  }
  const rows = data.countsByProperty;
  const pagination = !isGoals && (page > 1 || data.hasNextPage) && (
    <div className="mt-3 flex justify-end">
      <Pagination
        controls="simple"
        page={page}
        setPage={setPage}
        perPage={10}
        hasNextPage={data.hasNextPage}
      />
    </div>
  );
  if (rows.length === 0) {
    return (
      <>
        {dimSelect}
        <EmptyRows site={site} card={card} />
        {pagination}
      </>
    );
  }
  const secondaryMetric = isGoals
    ? "Conv. rate"
    : realCard === "events"
      ? null
      : realCard === "paths"
        ? "Pageviews"
        : "Visits";
  const max = Math.max(...rows.map((r) => r[1]), 1);
  const label = (first: string | [string, string]) => (Array.isArray(first) ? first[1] : first);
  const value = (first: string | [string, string]) => (Array.isArray(first) ? first[0] : first);

  return (
    <div className="mt-3">
      {dimSelect}
      <Table layout="fixed">
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <span className="mono-label">Name</span>
            </Table.Head>
            <Table.Head className="w-24 text-right">
              <span className="mono-label">
                {isGoals ? "Conversions" : card === "events" ? "Events" : "Visitors"}
              </span>
            </Table.Head>
            {hasRevenue && (
              <Table.Head className="w-24 text-right">
                <span className="mono-label">Revenue</span>
              </Table.Head>
            )}
            {secondaryMetric && (
              <Table.Head className="w-20 text-right">
                <span className="mono-label">{secondaryMetric}</span>
              </Table.Head>
            )}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row, index) => {
            const rowLabel = label(row[0]);
            const emptyDirect = realCard === "referrer" && rowLabel === "";
            const filterKey = emptyDirect ? undefined : realFilter;
            return (
              <Table.Row
                key={`${String(row[0])}-${index}`}
                className={`relative [&>*]:bg-transparent ${filterKey ? "cursor-pointer hover:[&>*]:bg-kumo-tint/30" : ""}`}
                onClick={filterKey ? () => onFilter({ [filterKey]: value(row[0]) }) : undefined}
              >
                <Table.Cell className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 rounded bg-kumo-tint"
                    style={{ width: `${(row[1] / max) * 100}%` }}
                  />
                  {filterKey ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="relative h-auto max-w-full justify-start px-1 py-1 text-left"
                      title={rowLabel}
                    >
                      <span className="line-clamp-2 whitespace-normal wrap-anywhere">
                        {rowLabel}
                      </span>
                    </Button>
                  ) : (
                    <span className="relative block truncate" title={rowLabel}>
                      {emptyDirect ? "Direct / None" : rowLabel}
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell className="relative tabular-nums text-right">
                  {new Intl.NumberFormat("en", {
                    notation: row[1] >= 100000 ? "compact" : "standard",
                  }).format(row[1])}
                </Table.Cell>
                {hasRevenue && (
                  <Table.Cell className="relative tabular-nums text-right">
                    {goalRevenue[label(row[0])] ?? "-"}
                  </Table.Cell>
                )}
                {secondaryMetric && (
                  <Table.Cell className="relative tabular-nums text-right">
                    {row[2] === undefined
                      ? "—"
                      : isGoals
                        ? `${row[2]}%`
                        : row[2].toLocaleString("en")}
                  </Table.Cell>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
      {pagination}
    </div>
  );
}

/* ---------- realtime tab ---------- */
function RealtimeTab({ realtime }: { realtime: ReturnType<typeof useRealtime> }) {
  const { stats, status } = realtime;
  const fmt = Intl.NumberFormat("en");
  return (
    <div className="flex flex-col gap-5">
      <Surface className="rounded-xl p-6">
        <div className="flex items-center gap-3">
          {status === "live" && <span className="live-dot" aria-hidden="true" />}
          <Text variant="secondary" size="sm">
            {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline"}
          </Text>
        </div>
        <span className="mt-3 block tabular-nums">
          <Text variant="heading1" as="h2">
            {stats?.currentVisitors ?? "—"}
          </Text>
        </span>
        <Text variant="secondary" size="sm">
          current visitors
        </Text>
      </Surface>
      <Grid variant="2up" gap="base">
        {[
          { label: "Visitors (30 min)", value: stats?.visitors30m },
          { label: "Pageviews (30 min)", value: stats?.pageviews30m },
        ].map((m) => (
          <Surface key={m.label} className="rounded-xl p-5">
            <Text variant="secondary" size="sm">
              {m.label}
            </Text>
            <Text variant="heading2" as="h3" DANGEROUS_className="mt-1 tabular-nums">
              {m.value !== undefined ? fmt.format(m.value) : "—"}
            </Text>
          </Surface>
        ))}
      </Grid>
      {stats && stats.topPages.length > 0 && (
        <Surface className="rounded-xl p-4">
          <Text variant="heading3" as="h2">
            Top pages
          </Text>
          <div className="mt-3">
            <Table layout="fixed">
              <Table.Header>
                <Table.Row>
                  <Table.Head>
                    <span className="mono-label">Page</span>
                  </Table.Head>
                  <Table.Head className="w-24 text-right">
                    <span className="mono-label">Views</span>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {stats.topPages.slice(0, 5).map((page) => (
                  <Table.Row key={page.pathname}>
                    <Table.Cell>
                      <span className="truncate">{page.pathname}</span>
                    </Table.Cell>
                    <Table.Cell className="tabular-nums text-right">{page.views}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </Surface>
      )}
      {stats && stats.topReferrers.length > 0 && (
        <Surface className="rounded-xl p-4">
          <Text variant="heading3" as="h2">
            Top referrers
          </Text>
          <div className="mt-3">
            <Table layout="fixed">
              <Table.Header>
                <Table.Row>
                  <Table.Head>
                    <span className="mono-label">Referrer</span>
                  </Table.Head>
                  <Table.Head className="w-24 text-right">
                    <span className="mono-label">Visitors</span>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {stats.topReferrers.slice(0, 5).map((r) => (
                  <Table.Row key={r.referrer}>
                    <Table.Cell>
                      <span className="truncate">{r.referrer || "Direct"}</span>
                    </Table.Cell>
                    <Table.Cell className="tabular-nums text-right">{r.visitors}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </Surface>
      )}
    </div>
  );
}

/* ---------- states ---------- */
/** Page-level loading state mirroring the real dashboard layout. */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-kumo-hairline p-4">
            <div className="skeleton h-3 w-16 rounded" />
            <div className="skeleton h-8 w-20 rounded" />
          </div>
        ))}
      </div>
      <div className="skeleton h-[300px] rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-kumo-hairline p-4">
            <div className="skeleton h-4 w-24 rounded" />
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="skeleton h-5 rounded" style={{ width: `${95 - j * 9}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MutedRows() {
  return (
    <div className="mt-3 space-y-2 py-1" aria-hidden="true">
      {[0.9, 0.7, 0.55, 0.4].map((w) => (
        <div key={w} className="h-5 rounded bg-kumo-recessed" style={{ width: `${w * 100}%` }} />
      ))}
    </div>
  );
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6 text-center">
      <Text variant="secondary" size="sm">
        {message}
      </Text>
      <div className="mt-2">
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyRows({ site, card }: { site: string; card: string }) {
  if (card === "goals") {
    return (
      <Empty
        title="No goals yet"
        description="Goals are created through the Sites API (PUT /api/v1/sites/goals)."
      />
    );
  }
  if (card === "events") {
    return (
      <Empty
        title="No custom events in this range"
        description="Send events with the tracker's track() call."
      />
    );
  }
  return (
    <Empty title="No data in this range" description={`No visits from ${site} in this range.`} />
  );
}
