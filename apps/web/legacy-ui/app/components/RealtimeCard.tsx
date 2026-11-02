import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { RealtimeStats } from "../../workers/site-events";

interface RealtimeCardProps {
    siteId: string;
}

const MAX_BACKOFF_MS = 30_000;

function useRealtime(siteId: string): RealtimeStats | null {
    const [stats, setStats] = useState<RealtimeStats | null>(null);
    const backoffRef = useRef(1_000);

    useEffect(() => {
        if (!siteId) return;
        let socket: WebSocket | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;

        const connect = () => {
            if (stopped) return;
            const protocol =
                window.location.protocol === "https:" ? "wss" : "ws";
            socket = new WebSocket(
                `${protocol}://${window.location.host}/realtime/${encodeURIComponent(siteId)}`,
            );
            socket.onopen = () => {
                backoffRef.current = 1_000;
            };
            socket.onmessage = (message) => {
                try {
                    setStats(JSON.parse(message.data) as RealtimeStats);
                } catch {
                    // ignore malformed snapshots
                }
            };
            socket.onclose = () => {
                if (stopped) return;
                const delay = backoffRef.current;
                backoffRef.current = Math.min(
                    backoffRef.current * 2,
                    MAX_BACKOFF_MS,
                );
                retryTimer = setTimeout(connect, delay);
            };
            socket.onerror = () => socket?.close();
        };
        connect();

        return () => {
            stopped = true;
            if (retryTimer) clearTimeout(retryTimer);
            socket?.close();
        };
    }, [siteId]);

    return stats;
}

function Sparkline({ values }: { values: number[] }) {
    const max = Math.max(...values, 1);
    return (
        <svg
            viewBox="0 0 120 24"
            className="h-6 w-full"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            {values.map((v, i) => {
                const height = Math.max((v / max) * 22, 1);
                return (
                    <rect
                        key={i}
                        x={i * 4}
                        y={24 - height}
                        width="3"
                        height={height}
                        className="fill-primary"
                    />
                );
            })}
        </svg>
    );
}

export default function RealtimeCard({ siteId }: RealtimeCardProps) {
    const stats = useRealtime(siteId);

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span
                        className={`inline-block h-2 w-2 rounded-full ${stats ? "bg-green-500" : "bg-muted-foreground/40"}`}
                    />
                    Realtime (last 30 min)
                </CardTitle>
            </CardHeader>
            <CardContent>
                {stats ? (
                    <div className="grid gap-4 md:grid-cols-[auto_1fr_1fr_1fr]">
                        <div>
                            <div className="text-2xl font-bold">
                                {stats.currentVisitors}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                current visitors
                            </div>
                            <div className="mt-3 w-32">
                                <Sparkline
                                    values={stats.pageviewsPerMinute}
                                />
                                <div className="text-xs text-muted-foreground">
                                    {stats.pageviews30m} pageviews
                                </div>
                            </div>
                        </div>
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                Top pages
                            </div>
                            <ul className="text-sm space-y-1">
                                {stats.topPages.slice(0, 5).map((p) => (
                                    <li
                                        key={p.pathname}
                                        className="flex justify-between gap-2 truncate"
                                    >
                                        <span className="truncate">
                                            {p.pathname}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {p.views}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                Top referrers
                            </div>
                            <ul className="text-sm space-y-1">
                                {stats.topReferrers.slice(0, 5).map((r) => (
                                    <li
                                        key={r.referrer}
                                        className="flex justify-between gap-2 truncate"
                                    >
                                        <span className="truncate">
                                            {r.referrer}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {r.views}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                Top countries
                            </div>
                            <ul className="text-sm space-y-1">
                                {stats.topCountries.slice(0, 5).map((c) => (
                                    <li
                                        key={c.country}
                                        className="flex justify-between gap-2 truncate"
                                    >
                                        <span className="truncate">
                                            {c.country}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {c.views}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">
                        Connecting…
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
