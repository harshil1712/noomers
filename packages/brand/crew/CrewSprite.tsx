// React renderer for the pixel crew. Same art as CREW_SILHOUETTES in crew.ts
// (parsed from it, so the two can't drift), drawn as ONE crisp SVG on the
// 3px cell grid: body 20×15 cells + 2 cells of legs. Static (no motion) —
// the site's vanilla crew.css sprite owns the step/hop animations.
// Decorative only: always aria-hidden; never put meaning in a sprite.
import type { CSSProperties } from "react";
import { CREW_SILHOUETTES } from "./crew";

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** CSS colour, or BODY for the sprite's `color` prop. */
  fill: string;
}

const BODY = "body";
const BODY_W = 20;
const BODY_H = 15;
const LEG_H = 2;
const VIEW_H = BODY_H + LEG_H;

// crew.ts writes "C" for the body colour, #fff for eyes/mouth and #FFC53D
// for antenna/visor pixels — map those to tokens. Anything else (e.g. a
// var() the art already uses) passes through unchanged.
function cellFill(raw: string): string {
  switch (raw.toLowerCase()) {
    case "c":
      return BODY;
    case "#fff":
    case "#ffffff":
      return "var(--crew-eye, #fff)";
    case "#ffc53d":
      return "var(--crew-accent, #ffc53d)";
    default:
      return raw;
  }
}

const RECT_RE =
  /<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"\s+fill="([^"]+)"\s*\/>/g;

function parseCells(svg: string): Cell[] {
  return Array.from(svg.matchAll(RECT_RE), (m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
    fill: cellFill(m[5] ?? BODY),
  }));
}

const ROBOTS = [
  parseCells(CREW_SILHOUETTES[0]),
  parseCells(CREW_SILHOUETTES[1]),
  parseCells(CREW_SILHOUETTES[2]),
  parseCells(CREW_SILHOUETTES[3]),
] as const;

// Same leg columns as crew.ts LEGS (x 4–7 and 12–15), drawn under the body.
const LEGS = [
  { x: 4, y: BODY_H, w: 4, h: LEG_H, fill: "var(--crew-legs)" },
  { x: 12, y: BODY_H, w: 4, h: LEG_H, fill: "var(--crew-legs)" },
] satisfies Cell[];

const tagStyle = {
  position: "absolute",
  bottom: "100%",
  left: "50%",
  transform: "translateX(-50%)",
  marginBottom: 2,
  whiteSpace: "nowrap",
  fontFamily: "var(--font-pixel)",
  fontSize: 11,
  lineHeight: 1,
  padding: "3px 6px",
  borderRadius: 4,
  background: "var(--crew-tag-bg, #121212)",
  color: "var(--crew-tag-fg, #fff)",
} satisfies CSSProperties;

export function CrewSprite({
  robot = 0,
  color = "--crew-1",
  size = 48,
  carry,
  flip = false,
  className,
}: {
  robot?: 0 | 1 | 2 | 3;
  /** Token name (e.g. "--crew-2") or any CSS colour. */
  color?: string;
  /** Rendered width in px; height follows the 20×17 cell grid. */
  size?: number;
  /** Optional tiny Pixelify label held above the sprite. */
  carry?: string;
  flip?: boolean;
  className?: string;
}) {
  const body = color.startsWith("--") ? `var(${color})` : color;
  const cells = [...LEGS, ...ROBOTS[robot]];
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ position: "relative", display: "inline-block", width: size, lineHeight: 0 }}
    >
      {carry ? <span style={tagStyle}>{carry}</span> : null}
      <svg
        width={size}
        height={(size * VIEW_H) / BODY_W}
        viewBox={`0 0 ${BODY_W} ${VIEW_H}`}
        className="ff-px"
        focusable="false"
        style={flip ? { transform: "scaleX(-1)" } : undefined}
      >
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            style={{ fill: c.fill === BODY ? body : c.fill }}
          />
        ))}
      </svg>
    </span>
  );
}
