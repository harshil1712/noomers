import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { z } from "zod";
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  ChartLegend,
  Code,
  Dialog,
  Empty,
  Grid,
  Select,
  Surface,
  Table,
  Tabs,
  Text,
  TimeseriesChart,
  Tooltip,
} from "@cloudflare/kumo";
import { ArrowSquareOut, CaretLeft, CaretRight, Globe, X } from "@phosphor-icons/react";
import { useDocumentTitle } from "../../lib/use-document-title";
import { themeColor } from "../../lib/use-is-dark";
import {
  dashboardApi,
  type BreakdownCard,
  type BreakdownResponse,
  type DashboardQuery,
  type RealtimeStats,
} from "../../lib/dashboard-api";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const INTERVALS = [
  { value: "day", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "Month to date" },
  { value: "6mo", label: "Last 6 months" },
  { value: "12mo", label: "Last 12 months" },
];

const FILTER_KEYS = [
  "path",
  "name",
  "referrer",
  "deviceType",
  "country",
  "browserName",
  "browserVersion",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

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
    card: BreakdownCard | "goals" | "events-props" | "campaigns";
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
  { title: "Pages", tabs: [{ card: "paths", label: "Top pages", filter: "path" }] },
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
    tabs: [
      { card: "events", label: "Events", filter: "name" },
      { card: "events-props", label: "Props" },
    ],
  },
];

interface SearchParams {
  site?: string;
  interval?: string;
  timezone?: string;
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
    ["site", "interval", "timezone", "tab", ...FILTER_KEYS].map((key) => [
      key,
      z.string().optional(),
    ]),
  ),
);

export const Route = createFileRoute("/_authed/dashboard")({
  validateSearch: (search: z.input<typeof searchSchema>): SearchParams => {
    const parsed = searchSchema.safeParse(search);
    return parsed.success ? parsed.data : {};
  },
  component: Dashboard,
});

function userTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.mode === "dark",
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setDark(el.dataset.mode === "dark"));
    observer.observe(el, { attributes: true, attributeFilter: ["data-mode"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

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
    ws.onclose = () => setStatus("offline");
    ws.onerror = () => setStatus("offline");
    ws.onmessage = (event) => {
      try {
        setStats(JSON.parse(event.data as string) as RealtimeStats);
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }, [siteId]);
  return { stats, status };
}

/* ---------- dashboard ---------- */
function Dashboard() {
  useDocumentTitle("Dashboard");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isDark = useIsDark();
  const [sites, setSites] = useState<string[] | null>(null);
  const [sitesError, setSitesError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [failures, setFailures] = useState<Set<string>>(new Set());

  const loadSites = () => {
    setSitesError(false);
    dashboardApi
      .sites()
      .then((r) => setSites(r.sites))
      .catch(() => setSitesError(true));
  };
  useEffect(loadSites, []);

  const site = search.site ?? "";
  useEffect(() => {
    if (sites && !site) {
      void navigate({ to: "/", replace: true });
    }
  }, [sites, site, navigate]);

  const interval = search.interval || "7d";
  const timezone = search.timezone || userTimezone();
  const tab = search.tab === "realtime" ? "realtime" : "overview";
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

  const query: DashboardQuery = { site, interval, timezone, filters, nonce };
  const realtime = useRealtime(site);

  const trackingSnippet = `<script defer\n  src="${location.origin}/tracker.js"\n  data-site-id="${site || "example.com"}"></script>`;
  const plausibleSnippet = `<script defer\n  src="${location.origin}/js/pa-XXXX.js"\n  data-domain="${site || "example.com"}"></script>`;
  const addSiteCmd = `curl -X POST ${location.origin}/api/v1/sites \\\n  -H "Authorization: Bearer $SITES_API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"domain": "example.com"}'`;

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* page header */}
      <div className="flex flex-col gap-3">
        <Breadcrumbs size="sm">
          <Breadcrumbs.Link href="/dashboard">Sites</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{site || "Dashboard"}</Breadcrumbs.Current>
        </Breadcrumbs>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Text variant="heading1" as="h1">
              {site || "Dashboard"}
            </Text>
            {site && (
              <Button
                variant="ghost"
                icon={<ArrowSquareOut size={16} />}
                aria-label={`Open ${site}`}
                onClick={() => window.open(`https://${site}`, "_blank")}
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
            <Select
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
            <Dialog.Root>
              <Dialog.Trigger render={<Button variant="secondary">Tracking code</Button>} />
              <Dialog className="p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <Dialog.Title>Tracking code</Dialog.Title>
                  <Dialog.Close aria-label="Close" />
                </div>
                <Dialog.Description>Add one of these snippets to your site.</Dialog.Description>
                <div className="mt-3 flex flex-col gap-4">
                  <div>
                    <Text variant="secondary" size="sm">
                      Script tag
                    </Text>
                    <Code.Block code={trackingSnippet} lang="tsx" />
                  </div>
                  <div>
                    <Text variant="secondary" size="sm">
                      Plausible-style
                    </Text>
                    <Code.Block code={plausibleSnippet} lang="tsx" />
                  </div>
                </div>
              </Dialog>
            </Dialog.Root>
          </div>
        </div>
      </div>

      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(filters).map(([key, value]) => (
            <Badge key={key} variant="primary">
              {key}: {value}
              <Button
                variant="ghost"
                size="xs"
                icon={<X size={12} />}
                aria-label={`Remove ${key} filter`}
                onClick={() => setSearch({ [key]: undefined })}
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
          description="Basin SQL didn't respond. Realtime still works."
          action={
            <Button variant="secondary" onClick={retryHistorical}>
              Retry
            </Button>
          }
        />
      )}

      {sitesError ? (
        <Surface className="rounded-xl p-8 text-center">
          <Text variant="heading3" as="h2">
            Couldn&apos;t load your sites
          </Text>
          <p className="mt-2 text-sm text-kumo-subtle">
            The dashboard API didn&apos;t respond. Check that you&apos;re signed in and try again.
          </p>
          <div className="mt-4 flex justify-center">
            <Button onClick={loadSites}>Retry</Button>
          </div>
        </Surface>
      ) : sites === null ? (
        <SkeletonBlock h={200} />
      ) : sites.length === 0 ? (
        <Empty
          title="No sites registered"
          description="Sites are registered through the Sites API — there's no site-management UI yet."
          commandLine={addSiteCmd}
        />
      ) : !site ? (
        <SkeletonBlock h={200} />
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
  useEffect(() => {
    let cancelled = false;
    setError(false);
    dashboardApi
      .stats(query)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          onError?.("stats", false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          onError?.("stats", true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query.site, query.interval, query.timezone, query.filters, query.nonce]);

  const fmt = Intl.NumberFormat("en", { notation: "compact" });
  const duration = (s: number) => {
    const r = Math.round(s);
    return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${r % 60}s`;
  };

  if (error) {
    return quiet ? (
      <div className="h-24 rounded-xl bg-kumo-recessed" aria-hidden="true" />
    ) : (
      <PanelError message="Stats didn't load — Basin SQL didn't respond." />
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
          : "0",
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
                {t.live && <span className="live-dot" aria-hidden="true" title={realtime.status} />}
                <span className="whitespace-nowrap tabular-nums">
                  <Text variant="heading1" as="h2">
                    {t.value}
                  </Text>
                </span>
              </div>
              <div className="mt-1 min-h-6">
                {t.live && realtime.status === "connecting" ? (
                  <Text variant="secondary" size="sm">
                    Connecting…
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
  const [data, setData] = useState<
    { name: string; color: string; data: [number, number][] }[] | null
  >(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    dashboardApi
      .timeseries(query)
      .then((res) => {
        if (cancelled) return;
        onError?.("timeseries", false);
        const brand = themeColor("--color-kumo-brand") || "#1f7a55";
        const second = themeColor("--color-kumo-series-2") || "#a08c6e";
        const muted = "rgba(128,128,128,0.35)";
        const toSeries = (key: "views" | "visitors", name: string, color: string) => ({
          name,
          color,
          data: res.chartData.map(
            (row) => [new Date(row.date).getTime(), row[key]] as [number, number],
          ),
        });
        setData(
          metric === "visitors"
            ? [toSeries("visitors", "Visitors", brand), toSeries("views", "Pageviews", muted)]
            : [toSeries("views", "Pageviews", second), toSeries("visitors", "Visitors", muted)],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          onError?.("timeseries", true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query.site, query.interval, query.timezone, query.filters, query.nonce, isDark, metric]);

  return (
    <Surface className="min-w-0 overflow-hidden rounded-xl p-4">
      {error ? (
        quiet ? (
          <div className="h-[300px] rounded-lg bg-kumo-recessed" aria-hidden="true" />
        ) : (
          <PanelError message="Chart didn't load — Basin SQL didn't respond." />
        )
      ) : !data ? (
        <div className="h-[300px] animate-pulse rounded-lg bg-kumo-recessed" />
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <ChartLegend.SmallItem
                name="Visitors"
                value=""
                color={themeColor("--color-kumo-brand")}
              />
              <ChartLegend.SmallItem
                name="Pageviews"
                value=""
                color={themeColor("--color-kumo-series-2")}
              />
            </div>
            <span className="mono-label">{timezone}</span>
          </div>
          <TimeseriesChart
            echarts={echarts}
            isDarkMode={isDark}
            data={data}
            height={300}
            yAxisMinInterval={1}
          />
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
  card: BreakdownCard | "goals" | "events-props" | "campaigns";
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
  const isGoals = card === "goals";
  const isProps = card === "events-props";

  useEffect(() => setPage(1), [realCard, query.site, query.interval, query.filters]);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (isProps) {
      setData({ countsByProperty: [], page: 1 });
      return;
    }
    const finish = (fn: () => void) => {
      if (!cancelled) fn();
    };
    if (isGoals) {
      dashboardApi
        .goals(query)
        .then((r) =>
          finish(() => {
            setData({
              countsByProperty: r.goals.map((g) => [
                g.name,
                g.conversions,
                Math.round(g.conversionRate),
              ]),
              page: 1,
            });
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
        .breakdown(realCard, { ...query, page })
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
      cancelled = true;
    };
  }, [
    realCard,
    isGoals,
    query.site,
    query.interval,
    query.timezone,
    query.filters,
    page,
    query.nonce,
  ]);

  const dimSelect = isCampaigns ? (
    <div className="mb-1 mt-3">
      <Select
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
        <PanelError message="Couldn't load — Basin SQL may be unconfigured." />
      </>
    );
  }
  if (!data) {
    return (
      <>
        {dimSelect}
        <div className="mt-3 space-y-2">
          {[0.9, 0.7, 0.55].map((w) => (
            <div
              key={w}
              className="h-5 animate-pulse rounded bg-kumo-recessed"
              style={{ width: `${w * 100}%` }}
            />
          ))}
        </div>
      </>
    );
  }
  const rows = data.countsByProperty;
  if (rows.length === 0) {
    return (
      <>
        {dimSelect}
        {isProps ? (
          <Text variant="secondary" size="sm">
            Custom-event property breakdown needs an event name and property key.
          </Text>
        ) : (
          <EmptyRows site={site} />
        )}
      </>
    );
  }
  const shown = rows.slice(0, 8);
  const max = Math.max(...shown.map((r) => r[1]), 1);
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
            <Table.Head className="w-14 text-right">
              <span className="mono-label">%</span>
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {shown.map((row, index) => {
            const pct = row[2] !== undefined ? row[2] : Math.round((row[1] / max) * 100);
            return (
              <Table.Row
                key={`${String(row[0])}-${index}`}
                tabIndex={0}
                role="button"
                className={`group/row relative ${realFilter ? "cursor-pointer" : ""} [&>*]:bg-transparent hover:[&>*]:bg-kumo-tint/30`}
                onClick={() => realFilter && onFilter({ [realFilter]: value(row[0]) })}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && realFilter) {
                    e.preventDefault();
                    onFilter({ [realFilter]: value(row[0]) });
                  }
                }}
              >
                <Table.Cell className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 rounded bg-kumo-tint"
                    style={{ width: `${(row[1] / max) * 100}%` }}
                  />
                  <span className="relative max-w-full truncate">{label(row[0])}</span>
                </Table.Cell>
                <Table.Cell className="relative tabular-nums text-right">
                  {new Intl.NumberFormat("en", {
                    notation: row[1] >= 100000 ? "compact" : "standard",
                  }).format(row[1])}
                </Table.Cell>
                <Table.Cell className="relative tabular-nums text-right">{pct}%</Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
      {!isGoals && rows.length >= 8 && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Text variant="secondary" size="sm">
            {(page - 1) * 10 + 1}–{(page - 1) * 10 + shown.length}
          </Text>
          <Button
            variant="ghost"
            icon={<CaretLeft size={14} />}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          />
          <Button
            variant="ghost"
            icon={<CaretRight size={14} />}
            aria-label="Next page"
            disabled={rows.length < 10}
            onClick={() => setPage(page + 1)}
          />
        </div>
      )}
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
          <span className="live-dot" aria-hidden="true" />
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
          <ul className="mt-3 space-y-1">
            {stats.topReferrers.slice(0, 5).map((r) => (
              <li key={r.referrer} className="flex justify-between text-sm">
                <span className="truncate">{r.referrer || "Direct"}</span>
                <span className="tabular-nums">{r.visitors}</span>
              </li>
            ))}
          </ul>
        </Surface>
      )}
    </div>
  );
}

/* ---------- states ---------- */
function SkeletonBlock({ h }: { h: number }) {
  return <div className="animate-pulse rounded-xl bg-kumo-recessed" style={{ height: h }} />;
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

function PanelError({ message }: { message: string }) {
  return (
    <div className="py-6 text-center">
      <Text variant="secondary" size="sm">
        {message}
      </Text>
      <div className="mt-2">
        <Button variant="ghost" size="sm" onClick={() => location.reload()}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyRows({ site }: { site: string }) {
  const snippet = `<script defer src="${location.origin}/tracker.js" data-site-id="${site}"></script>`;
  return (
    <Empty
      title="No data in this range"
      description={`Once the tracker is installed on ${site}, visits appear here within a few minutes.`}
      commandLine={snippet}
    />
  );
}
