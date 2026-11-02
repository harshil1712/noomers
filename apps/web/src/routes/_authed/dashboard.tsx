import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { z } from "zod";
import {
  Badge,
  Button,
  Empty,
  Loader,
  Select,
  Surface,
  Table,
  Text,
  TimeseriesChart,
} from "@cloudflare/kumo";
import { X } from "@phosphor-icons/react";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import {
  dashboardApi,
  type BreakdownCard,
  type BreakdownResponse,
  type DashboardQuery,
  type RealtimeStats,
} from "../../lib/dashboard-api";

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

const CARD_META: { card: BreakdownCard; title: string; filter?: FilterKey }[] = [
  { card: "paths", title: "Pages", filter: "path" },
  { card: "referrer", title: "Referrers", filter: "referrer" },
  { card: "utm-source", title: "UTM Source", filter: "utmSource" },
  { card: "utm-medium", title: "UTM Medium", filter: "utmMedium" },
  { card: "utm-campaign", title: "UTM Campaign", filter: "utmCampaign" },
  { card: "utm-term", title: "UTM Term", filter: "utmTerm" },
  { card: "utm-content", title: "UTM Content", filter: "utmContent" },
  { card: "country", title: "Countries", filter: "country" },
  { card: "browser", title: "Browsers", filter: "browserName" },
  { card: "browserversion", title: "Browser Versions", filter: "browserVersion" },
  { card: "device", title: "Devices", filter: "deviceType" },
  { card: "events", title: "Events", filter: "name" },
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

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

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

  useEffect(() => {
    dashboardApi
      .sites()
      .then((r) => setSites(r.sites))
      .catch(() => setSites([]));
  }, []);

  const site = search.site ?? "";
  // Once the site list lands, default to the first site if none selected.
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
  const removeFilter = (key: FilterKey) => setSearch({ [key]: undefined });

  const query: DashboardQuery = { site, interval, timezone, filters };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" />
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
        <div className="flex flex-wrap gap-2">
          {Object.entries(filters).map(([key, value]) => (
            <Badge key={key} variant="primary">
              {key}: {value}
              <button
                type="button"
                aria-label={`Remove ${key} filter`}
                className="ml-1 inline-flex"
                onClick={() => removeFilter(key as FilterKey)}
              >
                <X size={12} />
              </button>
            </Badge>
          ))}
        </div>
      </div>
      {!site ? (
        <Empty
          title="No site selected"
          description="Register a site to start collecting analytics."
        />
      ) : (
        <>
          <StatsCard query={query} />
          <Surface className="rounded-xl p-4">
            <Timeseries query={query} isDark={isDark} />
          </Surface>
          <RealtimeCard siteId={site} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {CARD_META.map((meta) => (
              <BreakdownCardView key={meta.card} meta={meta} query={query} onFilter={setSearch} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatsCard({ query }: { query: DashboardQuery }) {
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

  const count = Intl.NumberFormat("en", { notation: "compact" });
  const formatDuration = (seconds: number) => {
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  if (error) return <Bannerless message="Couldn't load stats." />;
  const stats: { label: string; value: string }[] = [
    { label: "Visitors", value: data?.visitors !== undefined ? count.format(data.visitors) : "-" },
    { label: "Visits", value: data?.visits !== undefined ? count.format(data.visits) : "-" },
    { label: "Views", value: data?.views !== undefined ? count.format(data.views) : "-" },
    {
      label: "Avg. duration",
      value:
        data?.averageVisitDuration !== undefined && data?.averageVisitDuration !== null
          ? formatDuration(data.averageVisitDuration)
          : "-",
    },
    {
      label: "Bounce rate",
      value: data?.bounceRate !== undefined ? `${Math.round(data.bounceRate * 100)}%` : "-",
    },
  ];
  return (
    <Surface className="rounded-xl p-6">
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label}>
            <Text variant="secondary" size="sm">
              {s.label}
            </Text>
            <div className="mt-1 text-3xl">{s.value}</div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function Timeseries({ query, isDark }: { query: DashboardQuery; isDark: boolean }) {
  const [data, setData] = useState<
    { name: string; color: string; data: [number, number][] }[] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .timeseries(query)
      .then((res) => {
        if (cancelled) return;
        const toSeries = (
          key: "views" | "visitors" | "bounceRate",
          name: string,
          color: string,
        ) => ({
          name,
          color,
          data: res.chartData.map(
            (row) => [new Date(row.date).getTime(), row[key]] as [number, number],
          ),
        });
        setData([
          toSeries("visitors", "Visitors", "#2f80ed"),
          toSeries("views", "Views", "#56ccf2"),
        ]);
      })
      .catch(() => !cancelled && setData([]));
    return () => {
      cancelled = true;
    };
  }, [query.site, query.interval, query.timezone, query.filters]);

  if (!data) return <Loader />;
  return (
    <TimeseriesChart
      echarts={echarts}
      isDarkMode={isDark}
      data={data}
      height={300}
      xAxisName="Time"
      yAxisName="Count"
      yAxisMinInterval={1}
    />
  );
}

function RealtimeCard({ siteId }: { siteId: string }) {
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
    <Surface className="rounded-xl p-6">
      <div className="flex items-center justify-between">
        <Text variant="secondary" size="sm">
          Realtime
        </Text>
        <Badge
          variant={status === "live" ? "success" : status === "connecting" ? "warning" : "error"}
        >
          {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-6">
        <div>
          <Text variant="secondary" size="sm">
            Current visitors
          </Text>
          <div className="mt-1 text-3xl">{stats?.currentVisitors ?? "-"}</div>
        </div>
        <div>
          <Text variant="secondary" size="sm">
            Visitors (30m)
          </Text>
          <div className="mt-1 text-3xl">{stats?.visitors30m ?? "-"}</div>
        </div>
        <div>
          <Text variant="secondary" size="sm">
            Pageviews (30m)
          </Text>
          <div className="mt-1 text-3xl">{stats?.pageviews30m ?? "-"}</div>
        </div>
      </div>
      {stats && stats.topPages.length > 0 && (
        <div className="mt-4">
          <Text variant="secondary" size="sm">
            Top pages
          </Text>
          <ul className="mt-2 space-y-1">
            {stats.topPages.slice(0, 5).map((page) => (
              <li key={page.page} className="flex justify-between text-sm">
                <span className="truncate">{page.page}</span>
                <span>{page.visitors}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Surface>
  );
}

function Bannerless({ message }: { message: string }) {
  return (
    <Surface className="rounded-xl p-6">
      <Text variant="secondary">{message}</Text>
    </Surface>
  );
}

function BreakdownCardView({
  meta,
  query,
  onFilter,
}: {
  meta: { card: BreakdownCard; title: string; filter?: FilterKey };
  query: DashboardQuery;
  onFilter: (patch: Partial<SearchParams>) => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BreakdownResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => setPage(1), [query.site, query.interval, query.filters]);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    dashboardApi
      .breakdown(meta.card, { ...query, page })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [meta.card, query.site, query.interval, query.timezone, query.filters, page]);

  const rows = data?.countsByProperty ?? [];
  const label = (first: string | [string, string]) => (Array.isArray(first) ? first[1] : first);

  return (
    <Surface className="rounded-xl p-4">
      <Text variant="secondary" size="sm">
        {meta.title}
      </Text>
      {error ? (
        <div className="py-6 text-center text-sm text-kumo-subtle">Couldn't load.</div>
      ) : !data ? (
        <div className="flex justify-center py-6">
          <Loader />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-kumo-subtle">No data</div>
      ) : (
        <Table className="mt-3">
          <Table.Header>
            <Table.Row>
              <Table.Head>Value</Table.Head>
              <Table.Head className="text-right">Visitors</Table.Head>
              <Table.Head className="text-right">
                {rows[0] && rows[0].length > 2 ? "Count" : "Events"}
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row, index) => (
              <Table.Row
                key={`${String(row[0])}-${index}`}
                className={meta.filter ? "cursor-pointer" : undefined}
                onClick={() =>
                  meta.filter &&
                  onFilter({ [meta.filter]: Array.isArray(row[0]) ? row[0][0] : row[0] })
                }
              >
                <Table.Cell className="max-w-0 truncate">{label(row[0])}</Table.Cell>
                <Table.Cell className="text-right">{row[1]}</Table.Cell>
                <Table.Cell className="text-right">{row[2] ?? ""}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      <div className="mt-3 flex items-center justify-between">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <Text variant="secondary" size="sm">
          Page {data?.page ?? page}
        </Text>
        <Button variant="secondary" disabled={rows.length < 10} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </Surface>
  );
}
