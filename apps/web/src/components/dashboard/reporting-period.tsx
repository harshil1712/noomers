import { Select } from "@cloudflare/kumo";
import { CalendarBlank } from "@phosphor-icons/react";

const periods = {
  "24h": "Last 24 hours",
  day: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "Month to date",
  "6mo": "Last 6 months",
  "12mo": "Last 12 months",
};

type Period = keyof typeof periods;

export function reportingPeriod(value: string | undefined, fallback: Period): Period {
  return value && Object.hasOwn(periods, value) ? (value as Period) : fallback;
}

export function ReportingPeriod({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <Select<Period>
      aria-label="Reporting period"
      value={value}
      items={periods}
      onValueChange={(period) => {
        if (period) onChange(period);
      }}
      renderValue={(period) => (
        <span className="flex items-center gap-2">
          <CalendarBlank size={16} aria-hidden />
          {periods[period ?? value]}
        </span>
      )}
    />
  );
}
