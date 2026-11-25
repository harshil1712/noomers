import { ReportingPeriod, reportingPeriod } from "../../components/dashboard/reporting-period";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod/mini";
import { Banner, Button, Empty, Grid, LinkButton, Surface, Text } from "@cloudflare/kumo";
import { ArrowSquareOut, Globe, WarningCircle } from "@phosphor-icons/react";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useIsDark } from "../../lib/use-is-dark";
import { dashboardApi, type StatsResponse } from "../../lib/dashboard-api";
import { DeltaBadge } from "../../components/dashboard/delta-badge";
import { PageHeader } from "../../components/page-header";
import { refreshSites, useSites as useSharedSites } from "../../lib/use-sites";
import { AddSiteDialog } from "../../components/dashboard/add-site-dialog";
import { NotOwnerNotice } from "../../components/dashboard/not-owner-notice";

const SiteTrend = lazy(() =>
  import("../../components/dashboard/analytics-charts").then((m) => ({ default: m.SiteTrend })),
);

const searchSchema = z.object({ interval: z.optional(z.string()) });

export const Route = createFileRoute("/_authed/")({
  validateSearch: (search: z.input<typeof searchSchema>) =>
    searchSchema.safeParse(search).data ?? {},
  component: SitesOverview,
});

const formatCount = new Intl.NumberFormat("en", { notation: "compact" });

const SiteCard = memo(function SiteCard({
  site,
  interval,
  isDark,
  attempt,
  onError,
  onRetry,
}: {
  site: string;
  interval: string;
  isDark: boolean;
  attempt: number;
  onError: (site: string) => void;
  onRetry: (sites: string[]) => void;
}) {
  const [data, setData] = useState<{ stats: StatsResponse; points: [number, number][] } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [missingIcon, setMissingIcon] = useState(false);
  const header = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!nearViewport) return;
    const controller = new AbortController();
    const query = { site, interval, filters: {} };
    setData(null);
    setFailed(false);
    void Promise.all([
      dashboardApi.stats(query, controller.signal),
      dashboardApi.timeseries(query, controller.signal),
    ]).then(
      ([stats, trend]) => {
        if (!controller.signal.aborted)
          setData({
            stats,
            points: trend.chartData.map((row) => [Date.parse(row.date), row.visitors]),
          });
      },
      () => {
        if (!controller.signal.aborted) {
          setFailed(true);
          onError(site);
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [site, interval, attempt, onError, nearViewport]);

  return (
    <Surface as="article" className="relative flex min-w-0 flex-col gap-4 rounded-xl p-4">
      <div ref={header} className="flex items-center gap-2">
        {missingIcon ? (
          <Globe size={16} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
        ) : (
          <img
            src={`/favicon?url=https://${site}`}
            loading="lazy"
            width={16}
            height={16}
            alt=""
            className="shrink-0"
            onError={() => setMissingIcon(true)}
          />
        )}
        <h2 className="min-w-0 flex-1">
          <Link
            to="/dashboard"
            search={{ site, interval }}
            className="block truncate font-medium hover:underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-kumo-brand"
          >
            {site}
          </Link>
        </h2>
        <LinkButton
          variant="ghost"
          size="sm"
          external
          href={`https://${site}`}
          className="relative"
          icon={<ArrowSquareOut size={16} />}
          aria-label={`Visit ${site} (opens in a new tab)`}
        />
      </div>
      {failed ? (
        <div className="flex min-h-24 items-center justify-between gap-2">
          <Text variant="secondary" size="sm">
            Couldn’t load analytics
          </Text>
          <Button
            variant="secondary"
            size="sm"
            className="relative"
            onClick={() => onRetry([site])}
          >
            Retry
          </Button>
        </div>
      ) : data ? (
        <>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <dt className="mono-label">Visitors</dt>
              <dd className="flex items-center gap-2 tabular-nums">
                <Text variant="heading2" as="span">
                  {data.stats.visitors == null ? "—" : formatCount.format(data.stats.visitors)}
                </Text>
                <span className="relative">
                  <DeltaBadge
                    current={data.stats.visitors}
                    previous={data.stats.previous?.visitors}
                    interval={interval}
                  />
                </span>
              </dd>
            </div>
            <div>
              <dt className="mono-label">Pageviews</dt>
              <dd className="tabular-nums">
                <Text variant="heading2" as="span">
                  {data.stats.views == null ? "—" : formatCount.format(data.stats.views)}
                </Text>
              </dd>
            </div>
          </dl>
          <div aria-hidden="true" className="pointer-events-none min-w-0">
            <Suspense fallback={<div className="h-12" />}>
              <SiteTrend points={data.points} isDark={isDark} />
            </Suspense>
          </div>
        </>
      ) : (
        <div role="status" className="flex min-h-24 flex-col gap-3">
          <span className="sr-only">Loading analytics for {site}</span>
          <div className="skeleton h-8 w-32 rounded" />
          <div className="skeleton h-12 rounded" />
        </div>
      )}
    </Surface>
  );
});

function SiteGrid({ sites, interval }: { sites: { domain: string }[]; interval: string }) {
  const isDark = useIsDark();
  const [failed, setFailed] = useState<string[]>([]);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const onError = useCallback(
    (site: string) => setFailed((prev) => (prev.includes(site) ? prev : [...prev, site])),
    [],
  );
  const onRetry = useCallback((domains: string[]) => {
    setFailed((prev) => prev.filter((site) => !domains.includes(site)));
    setAttempts((prev) => {
      const next = { ...prev };
      for (const domain of domains) next[domain] = (prev[domain] ?? 0) + 1;
      return next;
    });
  }, []);
  const failedSites = sites
    .filter(({ domain }) => failed.includes(domain))
    .map(({ domain }) => domain);
  return (
    <>
      {failedSites.length >= 3 && (
        <Banner
          variant="error"
          icon={<WarningCircle />}
          title="Historical data is unavailable"
          description={`Analytics could not load for ${failedSites.length} sites.`}
          action={
            <Button variant="secondary" onClick={() => onRetry(failedSites)}>
              Retry failed sites
            </Button>
          }
        />
      )}
      <Grid variant="3up" gap="sm">
        {sites.map(({ domain }) => (
          <SiteCard
            key={domain}
            site={domain}
            interval={interval}
            isDark={isDark}
            attempt={attempts[domain] ?? 0}
            onError={onError}
            onRetry={onRetry}
          />
        ))}
      </Grid>
    </>
  );
}

function SitesOverview() {
  useDocumentTitle("Sites");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { sites, error: sitesError, forbidden } = useSharedSites();
  const interval = reportingPeriod(search.interval, "24h");

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Sites"
        description={
          sites && sites.length > 0
            ? `${sites.length} site${sites.length === 1 ? "" : "s"} registered`
            : undefined
        }
        actions={
          forbidden || !sites?.length ? null : (
            <>
              <ReportingPeriod
                value={interval}
                onChange={(interval) => void navigate({ search: { interval } })}
              />
              <AddSiteDialog />
            </>
          )
        }
      />

      {forbidden ? (
        <NotOwnerNotice />
      ) : sitesError ? (
        <Empty
          icon={<WarningCircle size={24} />}
          title="Couldn't load your sites"
          contents={<Button onClick={() => void refreshSites()}>Retry</Button>}
        />
      ) : sites === null ? (
        <Grid variant="3up" gap="sm">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-36 rounded-xl" />
          ))}
        </Grid>
      ) : sites.length === 0 ? (
        <Empty
          icon={<Globe size={24} />}
          title="Add your first site"
          description="Register a domain, then add the tracking snippet to your site's <head>. Open Realtime on the site dashboard to see incoming visits."
          contents={<AddSiteDialog />}
        />
      ) : (
        <SiteGrid key={interval} sites={sites} interval={interval} />
      )}
    </div>
  );
}
