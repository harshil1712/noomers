import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { z } from "zod";
import {
  Badge,
  Button,
  Loader,
  Select,
  Surface,
  Tabs,
  Text,
  TimeseriesChart,
} from "@cloudflare/kumo";
import { X } from "@phosphor-icons/react";
import { useDocumentTitle } from "../../lib/use-document-title";
import {
  dashboardApi,
  type BreakdownCard,
  type BreakdownResponse,
  type DashboardQuery,
  type RealtimeStats,
} from "../../lib/dashboard-api";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
]);

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

/** Tabbed breakdown panels — 13 legacy cards collapsed into 6. */
const PANELS: {
  title: string;
  tabs: { card: BreakdownCard | "goals" | "props"; label: string; filter?: FilterKey }[];
}[] = [
  {
    title: "Sources",
    tabs: [
      { card: "referrer", label: "Referrers", filter: "referrer" },
      { card: "utm-source", label: "UTM source", filter: "utmSource" },
      { card: "utm-medium", label: "UTM medium", filter: "utmMedium" },
      { card: "utm-campaign", label: "UTM campaign", filter: "utmCampaign" },
      { card: "utm-term", label: "UTM term", filter: "utmTerm" },
      { card: "utm-content", label: "UTM content", filter: "utmContent" },
    ],
  },
  { title: "Pages", tabs: [{ card: "paths", label: "Paths", filter: "path" }] },
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
    title: "Events & properties",
    tabs: [
      { card: "events", label: "Events", filter: "name" },
      { card: "props", label: "Props" },
    ],
  },
];

interface SearchParams {
  site?: string;
  interval?: string;
  timezone?: string;
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
    ["site", "interval", "timezone", ...FILTER_KEYS].map((key) => [key, z.string().optional()]),
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

function Dashboard() {
  useDocumentTitle("Dashboard");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isDark = useIsDark();
  const [sites, setSites] = useState<string[] | null>(null);
  const [sitesError, setSitesError] = useState(false);

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
    if (sites && sites.length > 0 && !site) {
      void navigate({
        search: (prev: SearchParams) => ({ ...prev, site: sites[0] }),
        replace: true,
      });
    }
  }, [sites, site, navigate]);

  const interval = search.interval || "7d";
  const timezone = search.timezone || userTimezone();
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

  const query: DashboardQuery = { site, interval, timezone, filters };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={site}
          onValueChange={(v) => {
            if (v !== undefined && v !== null) setSearch({ site: v as string });
          }}
          placeholder="Select site..."
          renderValue={(v) => v}
        >
          {(sites ?? []).map((domain) => (
            <Select.Option key={domain} value={domain}>
              {domain}
            </Select.Option>
          ))}
        </Select>
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
        <LivePill siteId={site} />
      </div>

      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(filters).map(([key, value]) => (
            <Badge key={key} variant="primary">
              {key}: {value}
              <button
                type="button"
                aria-label={`Remove ${key} filter`}
                className="ml-1 inline-flex"
                onClick={() => setSearch({ [key]: undefined })}
              >
                <X size={12} />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      )}

      {sitesError ? (
        <StateBlock
          title="Couldn't load your sites"
          body="The dashboard API didn't respond. Check that you're signed in and try again."
          action={<Button onClick={loadSites}>Retry</Button>}
        />
      ) : sites === null ? (
        <Skeleton h={24} />
      ) : sites.length === 0 ? (
        <NoSites />
      ) : !site ? (
        <Skeleton h={24} />
      ) : (
        <>
          <StatStrip query={query} />
          <TimeseriesPanel query={query} isDark={isDark} timezone={timezone} />
          <RealtimePanel siteId={site} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PANELS.map((panel) => (
              <BreakdownPanel
                key={panel.title}
                panel={panel}
                query={query}
                onFilter={setSearch}
                site={site}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- live pill ---------- */
function LivePill({ siteId }: { siteId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!siteId) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/realtime/${siteId}`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as RealtimeStats;
        setCount(data.currentVisitors);
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }, [siteId]);
  if (count === null) return null;
  return (
    <a
      href="#realtime"
      className="live-pill inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm"
      style={{ background: "var(--live-tint)", color: "var(--live-text)" }}
    >
      <span className="live-dot" aria-hidden="true" />
      <span className="font-mono">{count} live</span>
    </a>
  );
}

/* ---------- stat strip ---------- */
function StatStrip({ query }: { query: DashboardQuery }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardApi.stats>> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    dashboardApi
      .stats(query)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query.site, query.interval, query.timezone, query.filters]);

  if (error) {
    return (
      <StateBlock
        title="Stats unavailable"
        body="Basin SQL didn't respond — historical metrics can't be computed right now."
      />
    );
  }
  const fmt = Intl.NumberFormat("en", { notation: "compact" });
  const duration = (s: number) => {
    const r = Math.round(s);
    return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${r % 60}s`;
  };
  const stats: { label: string; value: string }[] = [
    { label: "Visitors", value: data?.visitors !== undefined ? fmt.format(data.visitors) : "—" },
    { label: "Views", value: data?.views !== undefined ? fmt.format(data.views) : "—" },
    {
      label: "Bounce rate",
      value: data?.bounceRate !== undefined ? `${Math.round(data.bounceRate * 100)}%` : "—",
    },
    {
      label: "Visit duration",
      value:
        data?.averageVisitDuration !== undefined && data?.averageVisitDuration !== null
          ? duration(data.averageVisitDuration)
          : "—",
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
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-kumo-hairline bg-kumo-hairline sm:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="bg-kumo-elevated px-5 py-4">
          <div className="text-xs text-kumo-subtle">{s.label}</div>
          <div className="font-mono mt-1 text-2xl">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- timeseries ---------- */
function TimeseriesPanel({
  query,
  isDark,
  timezone,
}: {
  query: DashboardQuery;
  isDark: boolean;
  timezone: string;
}) {
  const [data, setData] = useState<
    { name: string; color: string; data: [number, number][] }[] | null
  >(null);
  const [midnightMs, setMidnightMs] = useState<number | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    dashboardApi
      .timeseries(query)
      .then((res) => {
        if (cancelled) return;
        const brand =
          getComputedStyle(document.documentElement)
            .getPropertyValue("--color-kumo-brand")
            .trim() || "#3D3FD9";
        const teal =
          getComputedStyle(document.documentElement).getPropertyValue("--series-2").trim() ||
          "#13877F";
        const toSeries = (key: "views" | "visitors", name: string, color: string) => ({
          name,
          color,
          data: res.chartData.map(
            (row) => [new Date(row.date).getTime(), row[key]] as [number, number],
          ),
        });
        setData([toSeries("visitors", "Visitors", brand), toSeries("views", "Views", teal)]);
        // 00:00 UTC today, rendered in the site timezone — only meaningful on
        // hourly (day-scale) ranges where a UTC midnight boundary crosses.
        if (res.intervalType === "HOUR" && res.chartData.length > 0) {
          const t0 = new Date(res.chartData[0].date).getTime();
          const t1 = new Date(res.chartData[res.chartData.length - 1].date).getTime();
          const now = Date.now();
          const utcMidnight = new Date(now);
          utcMidnight.setUTCHours(0, 0, 0, 0);
          const ms = utcMidnight.getTime();
          setMidnightMs(ms >= t0 && ms <= t1 ? ms : null);
        } else {
          setMidnightMs(null);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query.site, query.interval, query.timezone, query.filters, timezone]);

  if (error) {
    return (
      <StateBlock
        title="History unavailable"
        body="Basin SQL didn't respond. Realtime numbers still work; historical charts need the pipeline configured."
      />
    );
  }
  return (
    <Surface className="rounded-xl p-4">
      {!data ? (
        <div className="flex h-[300px] items-center justify-center">
          <Loader />
        </div>
      ) : (
        <TimeseriesChart
          echarts={echarts}
          isDarkMode={isDark}
          data={data}
          height={300}
          xAxisName={timezone}
          yAxisName="Count"
          yAxisMinInterval={1}
          markers={
            midnightMs !== null
              ? [
                  {
                    timestamp: midnightMs,
                    label: "IDs reset · 00:00 UTC",
                    color: "var(--color-kumo-subtle)",
                  },
                ]
              : undefined
          }
        />
      )}
    </Surface>
  );
}

/* ---------- realtime ---------- */
function RealtimePanel({ siteId }: { siteId: string }) {
  const [stats, setStats] = useState<RealtimeStats | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  useEffect(() => {
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

  return (
    <Surface id="realtime" className="rounded-xl p-5">
      <div className="flex items-center justify-between">
        <Text variant="secondary" size="sm">
          Realtime
        </Text>
        <span
          className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs"
          style={{ background: "var(--live-tint)", color: "var(--live-text)" }}
        >
          <span className="live-dot" aria-hidden="true" />
          {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-6">
        {[
          { label: "Current visitors", value: stats?.currentVisitors },
          { label: "Visitors (30m)", value: stats?.visitors30m },
          { label: "Pageviews (30m)", value: stats?.pageviews30m },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-xs text-kumo-subtle">{m.label}</div>
            <div className="font-mono mt-1 text-2xl" style={{ color: "var(--live-text)" }}>
              {m.value ?? "—"}
            </div>
          </div>
        ))}
      </div>
      {stats && stats.topPages.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-kumo-subtle">Top pages</div>
          <ul className="mt-2 space-y-1">
            {stats.topPages.slice(0, 5).map((page) => (
              <li key={page.page} className="flex justify-between text-sm">
                <span className="truncate">{page.page}</span>
                <span className="font-mono">{page.visitors}</span>
              </li>
            ))}
          </ul>
        </div>
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
}: {
  panel: (typeof PANELS)[number];
  query: DashboardQuery;
  onFilter: (patch: Partial<SearchParams>) => void;
  site: string;
}) {
  const [tab, setTab] = useState(panel.tabs[0].card);
  const active = panel.tabs.find((t) => t.card === tab) ?? panel.tabs[0];
  return (
    <Surface className="rounded-xl p-4">
      <div className="flex items-center justify-between">
        <Text variant="secondary" size="sm">
          {panel.title}
        </Text>
        {panel.tabs.length > 1 && (
          <Tabs
            variant="segmented"
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
}: {
  card: BreakdownCard | "goals" | "props";
  filter?: FilterKey;
  query: DashboardQuery;
  onFilter: (patch: Partial<SearchParams>) => void;
  site: string;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BreakdownResponse | null>(null);
  const [error, setError] = useState(false);
  const isGoals = card === "goals";

  useEffect(() => setPage(1), [card, query.site, query.interval, query.filters]);
  const isProps = card === "props";
  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (isProps) {
      setData({ countsByProperty: [], page: 1 });
      return;
    }
    if (isGoals) {
      dashboardApi
        .goals(query)
        .then((r) => {
          if (cancelled) return;
          setData({
            countsByProperty: r.goals.map((g) => [
              g.name,
              g.conversions,
              Math.round(g.conversionRate),
            ]),
            page: 1,
          });
        })
        .catch(() => !cancelled && setError(true));
    } else {
      dashboardApi
        .breakdown(card, { ...query, page })
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setError(true));
    }
    return () => {
      cancelled = true;
    };
  }, [card, isGoals, query.site, query.interval, query.timezone, query.filters, page]);

  if (error) {
    return (
      <div className="py-6 text-center text-sm text-kumo-subtle">
        Couldn't load — Basin SQL may be unconfigured.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-8">
        <Loader />
      </div>
    );
  }
  const rows = data.countsByProperty;
  if (rows.length === 0) {
    return isProps ? (
      <div className="py-6 text-center text-sm text-kumo-subtle">
        Custom-event property breakdown needs an event name and property key — the Sites API lists
        events at /api/v1/sites.
      </div>
    ) : (
      <EmptyRows site={site} />
    );
  }
  const max = Math.max(...rows.map((r) => r[1]), 1);
  const label = (first: string | [string, string]) => (Array.isArray(first) ? first[1] : first);
  const value = (first: string | [string, string]) => (Array.isArray(first) ? first[0] : first);

  return (
    <div className="mt-3">
      <ul className="space-y-1">
        {rows.map((row, index) => (
          <li key={`${String(row[0])}-${index}`}>
            <button
              type="button"
              disabled={!filter}
              onClick={() => filter && onFilter({ [filter]: value(row[0]) })}
              className="relative flex w-full items-center justify-between overflow-hidden rounded px-2 py-1.5 text-left text-sm disabled:cursor-default"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded"
                style={{
                  width: `${(row[1] / max) * 100}%`,
                  background: "var(--brand-tint)",
                }}
              />
              <span className="relative max-w-[70%] truncate">{label(row[0])}</span>
              <span className="relative font-mono text-xs">{row.slice(1).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
      {!isGoals && (
        <div className="mt-3 flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Text variant="secondary" size="sm">
            Page {data.page ?? page}
          </Text>
          <Button variant="secondary" disabled={rows.length < 10} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- states ---------- */
function Skeleton({ h }: { h: number }) {
  return <div className="animate-pulse rounded-xl bg-kumo-recessed" style={{ height: h * 10 }} />;
}

function StateBlock({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Surface className="rounded-xl p-8 text-center">
      <Text variant="heading">{title}</Text>
      <p className="mt-2 text-sm text-kumo-subtle">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Surface>
  );
}

function EmptyRows({ site }: { site: string }) {
  return (
    <div className="py-6 text-center">
      <Text variant="secondary" size="sm">
        No data in this range.
      </Text>
      <p className="mt-1 text-xs text-kumo-subtle">
        Once the tracker is installed on {site}, visits appear here within a few minutes.
      </p>
    </div>
  );
}

function NoSites() {
  const snippet = `curl -X POST https://app.noomers.dev/api/v1/sites \\
  -H "Authorization: Bearer $SITES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "example.com"}'`;
  return (
    <StateBlock
      title="No sites registered"
      body="Sites are registered through the Sites API — there's no site-management UI yet. Register one, then install the tracker."
      action={
        <pre className="overflow-x-auto rounded-lg bg-kumo-recessed p-4 text-left text-xs font-mono">
          {snippet}
        </pre>
      }
    />
  );
}
