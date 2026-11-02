# noomers design system

**Direction: "counts the day, forgets the night."** Visitor IDs are salted per
day and rotate at 00:00 UTC — noomers counts visits but forgets visitors every
midnight. Light mode is day; dark mode is night. Default follows system; the
theme toggle overrides it.

## Palette

Every color is a single `light-dark()` declaration in `packages/brand/tokens.css`
(Kumo token names kept; `html[data-mode]` pins the mode).

| Token                           | Day (light)           | Night (dark) |
| ------------------------------- | --------------------- | ------------ |
| canvas                          | `#F3F4F7`             | `#0E1124`    |
| elevated / base                 | `#FFFFFF`             | `#161A31`    |
| recessed / overlay              | `#E9EBF0`             | `#1D2240`    |
| control                         | `#FFFFFF`             | `#1D2240`    |
| tint / fill-hover               | `#ECEEF4`             | `#232848`    |
| line / fill                     | `#D9DCE4`             | `#2A3052`    |
| hairline                        | `#E4E6EC`             | `#232848`    |
| control-line                    | `#7C8299`             | `#6A7196`    |
| text default                    | `#161A2E`             | `#E8EAF4`    |
| text strong                     | `#0B0D1A`             | `#F6F7FC`    |
| text subtle                     | `#545B73`             | `#9AA0BD`    |
| placeholder                     | `#6B7189`             | `#8A90AE`    |
| inactive                        | `#A3A8BA`             | `#555B7A`    |
| brand                           | `#3D3FD9`             | `#8F93FF`    |
| brand-hover                     | `#2F31B8`             | `#A9ACFF`    |
| brand-ink (text on brand)       | `#FFFFFF`             | `#0E1124`    |
| brand-text                      | `#3537C4`             | `#9DA0FF`    |
| brand-tint                      | `#E3E4FB`             | `#24275A`    |
| live dot / text (realtime only) | `#E39A14` / `#8A5600` | `#F2B33D`    |
| live-tint                       | `#FBEFD6`             | `#3A2E14`    |
| series-1                        | brand                 | brand        |
| series-2                        | `#13877F`             | `#3FD1C4`    |
| danger                          | `#C2362F`             | `#FF7A70`    |
| success                         | `#18794E`             | `#5FD49A`    |

### Contrast (WCAG 2.x, measured)

| Pair                     | Ratio | Pair                          | Ratio |
| ------------------------ | ----- | ----------------------------- | ----- |
| default on canvas        | 15.63 | dark default on canvas        | 15.57 |
| default on elevated      | 17.19 | dark default on elevated      | 14.28 |
| strong on elevated       | 19.32 | dark strong on elevated       | 16.01 |
| subtle on canvas         | 6.12  | dark subtle on canvas         | 7.24  |
| subtle on elevated       | 6.73  | dark subtle on elevated       | 6.64  |
| placeholder on elevated  | 4.83  | dark placeholder on elevated  | 5.45  |
| brand-text on elevated   | 8.42  | dark brand-text on elevated   | 7.26  |
| brand on canvas          | 6.56  | dark brand on canvas          | 6.92  |
| brand-ink on brand       | 7.21  | dark brand-ink on brand       | 6.92  |
| control-line on elevated | 3.81  | dark control-line on elevated | 3.60  |
| live-text on live-tint   | 5.40  | dark live-text on live-tint   | 7.14  |
| danger on elevated       | 5.44  | dark danger on elevated       | 6.74  |

Non-text data colors are exempt by role: `inactive` (2.37 / 2.58 — decorative
disabled state, not required text) and `series-2` (4.38 light / 9.08 dark —
chart data color, never body copy).

## Type

- **Display:** Bricolage Grotesque Variable (`@fontsource-variable/bricolage-grotesque` 5.3.0, published 2026-07-19). Headings ≥20px and the wordmark only; weight 600–700, `letter-spacing: -0.02em`, `opsz` axis used (`.font-display`).
- **Body/UI:** Hanken Grotesk Variable (5.3.0, 2026-07-19).
- **Data/mono:** Martian Mono Variable (5.3.0, 2026-07-19) with `font-variant-numeric: tabular-nums` (`.mono`, `.font-mono`) — stat values, table counts, chart axes, code. This is data, not a costume.
- Removed: Instrument Sans, JetBrains Mono, Pixelify Sans.

## Logo

Two circles side by side, slightly overlapping: left filled in brand = today's
visitor ID; right outlined in brand = yesterday's forgotten one. Wordmark
"noomers" lowercase in Bricolage 700 beside it (not all-caps, not pixel).
`packages/brand/logo.svg`, `Logo.tsx` (props `size`, `markOnly`), `Logo.astro`,
`favicon.svg` + 32px PNG + 180px apple-touch in both apps' public dirs.
The old crew/pixel sprite system is deleted.

## Signature

Two uses of the same fact — one ornamented, one functional:

- **Site hero:** a 24-hour ring. 24 ticks, "00:00 UTC" on top, dots appear
  clockwise over a ~12s "day" and fade out as the loop passes midnight
  (WAAPI; `prefers-reduced-motion` gets a static partial-day ring).
  Caption in view: "Visitor IDs are salted per day and rotate at 00:00 UTC."
- **Dashboard chart:** on hourly intervals, a markLine at 00:00 UTC (converted
  to the site timezone) labeled "IDs reset · 00:00 UTC" — drawn only when the
  midnight boundary falls inside the range.

## Dashboard (Operate mode)

Precision, not decoration: sticky top bar (logo · site switcher · interval ·
live pill · theme · user menu), filter-chips row sourced from URL search
params, one-row stat strip in Martian Mono, full-width chart, six tabbed
breakdown panels (Sources / Pages / Locations / Devices / Goals / Events &
properties) with brand-tint proportion bars, and one amber-accented realtime
panel. Realtime is the only place the amber `live` tokens appear.

## Motion

- One authored moment per surface: the ring loop on the site, the pulse on the
  live dot in the app — both suppressed under `prefers-reduced-motion`.
- No scattered entrance animations; state changes only (hover, focus rings,
  loading skeletons).

## Browser surfaces

Themed, not default: `data-mode`-driven `color-scheme`, focus ring =
`--color-kumo-focus`, tabular numerals on all counts, mono code on
recessed surfaces.
