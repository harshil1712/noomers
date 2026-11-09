import { Badge, Tooltip } from "@cloudflare/kumo";

export const INTERVAL_LABEL = {
  day: "previous day",
  "24h": "previous 24 hours",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
  month: "previous month",
  "6mo": "previous 6 months",
  "12mo": "previous 12 months",
} as const;

export function DeltaBadge({
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
  const label =
    interval in INTERVAL_LABEL
      ? INTERVAL_LABEL[interval as keyof typeof INTERVAL_LABEL]
      : "previous period";
  return (
    <Tooltip
      content={`vs. ${label}`}
      render={
        <Badge variant={good ? "success" : "destructive"}>
          {up ? "↑" : "↓"} {Math.abs(pct)}%
        </Badge>
      }
    />
  );
}
