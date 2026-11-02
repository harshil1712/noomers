// Pixel-flame logo — single source for Logo.tsx, Logo.astro and logo.svg.
// 8×10 cell grid (viewBox "0 0 8 10"). Fills are CSS custom properties from
// tokens.css so the mark follows light/dark mode; LOGO_FALLBACK holds the
// resolved light values, used by the static logo.svg (and if tokens.css
// isn't loaded).

export const LOGO_VIEWBOX = { width: 8, height: 10 } as const;

export const LOGO_FALLBACK = {
  "--color-kumo-brand": "#C73D19",
  "--brand-text": "#B8360F",
  "--brand-lite": "#F08C66",
  "--highlight": "#FFC53D",
} as const;

export type LogoFill = keyof typeof LOGO_FALLBACK;

export interface LogoCell {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: LogoFill;
}

/** Back-to-front: flame body, darker base, lighter core, one highlight pixel. */
export const LOGO_CELLS = [
  { x: 4, y: 0, w: 1, h: 1, fill: "--color-kumo-brand" },
  { x: 3, y: 1, w: 3, h: 1, fill: "--color-kumo-brand" },
  { x: 3, y: 2, w: 4, h: 1, fill: "--color-kumo-brand" },
  { x: 2, y: 3, w: 5, h: 1, fill: "--color-kumo-brand" },
  { x: 1, y: 4, w: 6, h: 1, fill: "--color-kumo-brand" },
  { x: 1, y: 5, w: 7, h: 1, fill: "--color-kumo-brand" },
  { x: 1, y: 6, w: 6, h: 1, fill: "--color-kumo-brand" },
  { x: 1, y: 7, w: 5, h: 1, fill: "--color-kumo-brand" },
  { x: 2, y: 8, w: 3, h: 1, fill: "--brand-text" },
  { x: 3, y: 9, w: 2, h: 1, fill: "--brand-text" },
  { x: 3, y: 5, w: 2, h: 2, fill: "--brand-lite" },
  { x: 3, y: 7, w: 2, h: 1, fill: "--brand-lite" },
  { x: 6, y: 5, w: 1, h: 1, fill: "--highlight" },
] as const satisfies readonly LogoCell[];

/** CSS fill value for a cell: the token with its light fallback. */
export function logoFill(fill: LogoFill): string {
  return `var(${fill}, ${LOGO_FALLBACK[fill]})`;
}

/** Inner <rect> markup. `resolved` = hardcoded light hex (for static files). */
export function logoRects(resolved = false): string {
  return LOGO_CELLS.map(
    (c) =>
      `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${
        resolved ? LOGO_FALLBACK[c.fill] : logoFill(c.fill)
      }"/>`,
  ).join("");
}

/** Wordmark text (lowercase product mark). */
export const LOGO_WORDMARK = "noomers";
