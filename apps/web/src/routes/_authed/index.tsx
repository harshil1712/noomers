import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { z } from "zod";
import {
  Banner,
  Breadcrumbs,
  Button,
  ChartPalette,
  Empty,
  Grid,
  Select,
  Surface,
  Text,
  Chart,
} from "@cloudflare/kumo";
import { ArrowSquareOut, Globe } from "@phosphor-icons/react";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useIsDark as dark } from "../../lib/use-is-dark";
import { dashboardApi, type DashboardQuery } from "../../lib/dashboard-api";
import { DeltaBadge } from "../../components/dashboard/delta-badge";
import { AddSiteDialog } from "../../components/dashboard/add-site-dialog";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const OVERVIEW_INTERVALS = [
  { value: "1d", label: "Last 24 hours" },
  { value: "day", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const searchSchema = z.object({ interval: z.string().optional() });

export const Route = createFileRoute("/_authed/")({
  validateSearch: (s: z.input<typeof searchSchema>) =>
    searchSchema.safeParse(s).success ? searchSchema.parse(s) : {},
  component: SitesOverview,
});

function useIsDark(): boolean {
  return dark();
}

function siteFavicon(domain: string) {
  return `/favicon?url=https://${domain}`;
}

function SiteCard({
  site,
  interval,
  timezone,
  isDark,
  onError,
}: {
  site: string;
  interval: string;
  timezone: string;
  isDark: boolean;
  onError: (key: string, failed: boolean) => void;
}) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof dashboardApi.stats>> | null>(null);
  const [series, setSeries] = useState<
    { name: string; color: string; data: [number, number][] }[] | null
  >(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const query: DashboardQuery = {
    site,
    interval,
    timezone,
    filters: {},
    nonce,
  };

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setLoading(true);
    void Promise.allSettled([dashboardApi.stats(query), dashboardApi.timeseries(query)]).then(
      ([sRes, tRes]) => {
        if (cancelled) return;
        setLoading(false);
        if (sRes.status === "fulfilled") {
          setStats(sRes.value);
        }
        if (tRes.status === "fulfilled") {
          setSeries([
            {
              name: "Visitors",
              color: ChartPalette.categorical(0, isDark),
              data: tRes.value.chartData.map(
                (r) => [new Date(r.date).getTime(), r.visitors] as [number, number],
              ),
            },
          ]);
        }
        const failed = sRes.status === "rejected" || tRes.status === "rejected";
        setError(failed);
        onError(`card:${site}`, failed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [site, interval, timezone, isDark, nonce]);

  const fmt = Intl.NumberFormat("en", { notation: "compact" });
  const visitors = stats?.visitors;

  return (
    <Link
      to="/dashboard"
      search={{ site }}
      className="block rounded-xl focus-visible:ring-2 focus-visible:ring-kumo-brand"
    >
      <Surface className="flex h-full flex-col gap-3 rounded-xl p-4">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={siteFavicon(site)}
            width={16}
            height={16}
            alt=""
            className="shrink-0"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.nextElementSibling?.removeAttribute("aria-hidden");
            }}
          />
          <Globe size={16} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
          <span className="min-w-0 flex-1 truncate font-medium" style={{ fontWeight: 500 }}>
            {site}
          </span>
          <Button
            variant="ghost"
            size="xs"
            icon={<ArrowSquareOut size={14} />}
            aria-label={`Open ${site}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(`https://${site}`, "_blank");
            }}
          />
        </div>
        {loading ? (
          <div className="space-y-2">
            <div className="h-8 w-24 animate-pulse rounded bg-kumo-recessed" />
            <div className="h-14 animate-pulse rounded bg-kumo-recessed" />
          </div>
        ) : error ? (
          <div className="py-4">
            <Text variant="secondary" size="sm">
              Couldn&apos;t load stats
            </Text>
            <div className="mt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setNonce((n) => n + 1);
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                <Text variant="heading1" as="span">
                  {visitors !== undefined ? fmt.format(visitors) : "—"}
                </Text>
              </span>
              <span className="mono-label">visitors</span>
              <DeltaBadge
                current={visitors}
                previous={stats?.previous?.visitors}
                interval={interval}
              />
            </div>
            {series && (
              <div className="min-w-0">
                <Chart
                  echarts={echarts}
                  height={56}
                  options={{
                    grid: { left: 0, right: 0, top: 2, bottom: 0 },
                    xAxis: { type: "time", show: false },
                    yAxis: { type: "value", show: false, min: "dataMin" },
                    tooltip: { show: false },
                    series: [
                      {
                        type: "line",
                        data: series[0].data,
                        showSymbol: false,
                        silent: true,
                        lineStyle: { width: 1.5, color: series[0].color },
                        color: series[0].color,
                        areaStyle: { color: series[0].color, opacity: isDark ? 0.18 : 0.12 },
                      },
                    ],
                  }}
                />
              </div>
            )}
          </>
        )}
      </Surface>
    </Link>
  );
}

function SitesOverview() {
  useDocumentTitle("Sites");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isDark = useIsDark();
  const [sites, setSites] = useState<string[] | null>(null);
  const [sitesError, setSitesError] = useState(false);
  const [failures, setFailures] = useState<Set<string>>(new Set());
  const interval = search.interval || "1d";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    dashboardApi
      .sites()
      .then((r) => setSites(r.sites))
      .catch(() => setSitesError(true));
  }, []);

  const reportError = (key: string, failed: boolean) => {
    setFailures((prev) => {
      const next = new Set(prev);
      if (failed) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const basinDown = failures.size >= 3;

  const addCmd = `curl -X POST ${location.origin}/api/v1/sites \\\n  -H "Authorization: Bearer $SITES_API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"domain": "example.com"}'`;

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-3">
        <Breadcrumbs size="sm">
          <Breadcrumbs.Current>Sites</Breadcrumbs.Current>
        </Breadcrumbs>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Text variant="heading1" as="h1">
              Sites
            </Text>
            {sites && (
              <Text variant="secondary" size="sm">
                {sites.length} site{sites.length === 1 ? "" : "s"} registered
              </Text>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={interval}
              onValueChange={(v) => {
                if (v) void navigate({ search: { interval: v as string } });
              }}
              renderValue={(v) => OVERVIEW_INTERVALS.find((i) => i.value === v)?.label ?? v}
            >
              {OVERVIEW_INTERVALS.map((o) => (
                <Select.Option key={o.value} value={o.value}>
                  {o.label}
                </Select.Option>
              ))}
            </Select>
            <AddSiteDialog />
          </div>
        </div>
      </div>

      {basinDown && (
        <Banner
          variant="error"
          icon={<Globe weight="fill" />}
          title="Historical data is unavailable"
          description="Basin SQL didn't respond."
          action={
            <Button variant="secondary" onClick={() => setFailures(new Set())}>
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
          <Button className="mt-4" onClick={() => location.reload()}>
            Retry
          </Button>
        </Surface>
      ) : sites === null ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-kumo-recessed" />
          ))}
        </div>
      ) : sites.length === 0 ? (
        <Empty
          title="No sites registered"
          description="Sites are registered through the Sites API — there's no site-management UI yet."
          commandLine={addCmd}
        />
      ) : (
        <Grid variant="3up" gap="base">
          {sites.map((site) => (
            <SiteCard
              key={site}
              site={site}
              interval={interval}
              timezone={timezone}
              isDark={isDark}
              onError={reportError}
            />
          ))}
        </Grid>
      )}
    </div>
  );
}
