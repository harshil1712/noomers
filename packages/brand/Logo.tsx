import { LOGO_CELLS, LOGO_VIEWBOX, LOGO_WORDMARK, logoFill } from "./logo-cells";

const { width: W, height: H } = LOGO_VIEWBOX;

export function Logo({ size = 22, wordmark = false }: { size?: number; wordmark?: boolean }) {
  const mark = (
    <svg
      width={size}
      height={size * (H / W)}
      viewBox={`0 0 ${W} ${H}`}
      className="ff-px"
      aria-hidden="true"
      focusable="false"
    >
      {LOGO_CELLS.map((c) => (
        <rect
          key={`${c.x}-${c.y}-${c.fill}`}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          style={{ fill: logoFill(c.fill) }}
        />
      ))}
    </svg>
  );
  if (!wordmark) return mark;
  return (
    <span className="inline-flex items-center gap-2">
      {mark}
      <span className="font-display font-bold text-lg lowercase">{LOGO_WORDMARK}</span>
    </span>
  );
}
