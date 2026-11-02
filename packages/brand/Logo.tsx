/**
 * noomers mark: two circles, today's filled ID beside yesterday's
 * forgotten (outlined) one — visitor IDs rotate at 00:00 UTC.
 */
export function Logo({
  size = 24,
  markOnly = false,
  className,
}: {
  size?: number;
  markOnly?: boolean;
  className?: string;
}) {
  const r = size * 0.29;
  const stroke = Math.max(2, size * 0.08);
  const gap = size * 0.1;
  return (
    <span className={["inline-flex items-baseline gap-2", className].filter(Boolean).join(" ")}>
      <svg
        width={r * 4 + gap + stroke}
        height={r * 2 + stroke * 2}
        viewBox={`0 0 ${r * 4 + gap + stroke} ${r * 2 + stroke * 2}`}
        aria-hidden="true"
      >
        <circle cx={r} cy={r + stroke} r={r} fill="var(--color-kumo-brand)" />
        <circle
          cx={r * 3 + gap + stroke / 2}
          cy={r + stroke}
          r={r}
          fill="none"
          stroke="var(--color-kumo-brand)"
          strokeWidth={stroke}
        />
      </svg>
      {!markOnly && (
        <span className="font-display text-lg font-bold tracking-tight text-kumo-default">
          noomers
        </span>
      )}
    </span>
  );
}
