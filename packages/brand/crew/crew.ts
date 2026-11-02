// Pixel crew sprites: shared art for React, Astro and vanilla JS.
// Robots are SVG rect art on a ~3px grid; colors come from --crew-1..4 CSS vars (tokens.css).

/** Valid robot indices for `crewSpriteHTML` / `crewHTML`. */
export type CrewRobot = 0 | 1 | 2 | 3;

export const CREW_SILHOUETTES = {
  0: `<rect x="5" y="0" width="10" height="8" fill="C"/><rect x="7" y="4" width="2" height="2" fill="#fff"/><rect x="11" y="4" width="2" height="2" fill="#fff"/><rect x="8" y="7" width="4" height="1" fill="#fff"/><rect x="4" y="8" width="12" height="7" fill="C"/>`,
  1: `<rect x="4" y="0" width="4" height="2" fill="C"/><rect x="12" y="0" width="4" height="2" fill="C"/><rect x="5" y="1" width="10" height="7" fill="C"/><rect x="7" y="4" width="2" height="2" fill="#fff"/><rect x="11" y="4" width="2" height="2" fill="#fff"/><rect x="4" y="8" width="12" height="7" fill="C"/>`,
  2: `<rect x="9" y="0" width="2" height="2" fill="#FFC53D"/><rect x="5" y="2" width="10" height="6" fill="C"/><rect x="7" y="4" width="2" height="2" fill="#fff"/><rect x="11" y="4" width="2" height="2" fill="#fff"/><rect x="4" y="8" width="12" height="7" fill="C"/>`,
  3: `<rect x="5" y="0" width="10" height="8" fill="C"/><rect x="6" y="1" width="8" height="1" fill="#FFC53D"/><rect x="7" y="4" width="2" height="2" fill="#fff"/><rect x="11" y="4" width="2" height="2" fill="#fff"/><rect x="4" y="8" width="12" height="7" fill="C"/><rect x="15" y="9" width="2" height="2" fill="C"/>`,
};

const LEGS = `<svg width="60" height="14" viewBox="0 0 20 5" shape-rendering="crispEdges"><rect x="4" y="0" width="4" height="5" fill="var(--crew-legs)"/><rect x="12" y="0" width="4" height="5" fill="var(--crew-legs)"/></svg>`;

/** Inner HTML of one crew member (.sp wrapper still needed). colorVar like '--crew-1'. */
export function crewSpriteHTML(
  robot: CrewRobot,
  colorVar = "--crew-1",
  carry?: string,
  flip = false,
): string {
  const sil = (CREW_SILHOUETTES[robot] ?? CREW_SILHOUETTES[0]).replaceAll("C", `var(${colorVar})`);
  // `scale` (not `transform`) so the flip survives the step/hop keyframes, which animate transform.
  const t = flip ? ' style="scale:-1 1"' : "";
  return `<span class="sp-legs"${t}>${LEGS}</span><span class="sp-body"${t}><svg width="60" height="46" viewBox="0 0 20 15" shape-rendering="crispEdges">${sil}</svg></span><span class="sp-eye" style="left:20px;top:24px"></span><span class="sp-eye" style="left:34px;top:24px"></span>${carry ? `<span class="carry">${carry}</span>` : ""}`;
}

/** Full decorative sprite element HTML (aria-hidden). In Astro, prefer apps/site Crew.astro. */
export function crewHTML(
  robot: CrewRobot,
  colorVar = "--crew-1",
  carry?: string,
  flip = false,
  cls = "sp",
  opts: { index?: number } = {},
): string {
  const idx = opts.index === undefined ? "" : ` data-i="${opts.index}" style="--i:${opts.index}"`;
  return `<span class="${cls}"${idx} aria-hidden="true">${crewSpriteHTML(robot, colorVar, carry, flip)}</span>`;
}
