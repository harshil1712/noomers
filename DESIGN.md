# noomers design system

Warm paper/stone palette over Kumo's semantic tokens — one chromatic accent
(moss green) reserved for the primary action, selected state, main chart
series and keyword highlight. Inter Tight 400 headings ("quiet authority"),
Inter body, IBM Plex Mono uppercase metadata labels. Hairlines are the
structural device; no card shadows (the site's product screenshot is the one
exception).

## Tokens (`packages/brand/tokens.css`, `light-dark()` pairs)

| token                 | light   | dark    |
| --------------------- | ------- | ------- |
| canvas                | #F7F6F3 | #0F0E0D |
| base/elevated         | #FFFFFF | #191816 |
| recessed/overlay/tint | #F1EFEB | #22201E |
| fill-hover            | #EAE7E2 | #2A2725 |
| line                  | #E7E4DF | #2E2B28 |
| hairline              | #EEEBE6 | #262422 |
| control-line          | #8C857E | #6E6862 |
| text default          | #1C1917 | #EDEBE8 |
| strong                | #0C0A09 | #FAFAF9 |
| subtle                | #6F6862 | #A39D96 |
| placeholder           | #7A736C | #8F8982 |
| brand (moss)          | #1F7A55 | #4FC08D |
| brand-hover           | #186446 | #6BD0A1 |
| brand-ink (on brand)  | #FFFFFF | #0F0E0D |
| brand-tint            | #E3F1EA | #16291F |
| brand-text            | #1F7A55 | #4FC08D |
| series-2 (brass)      | #A08C6E | #8C7B62 |

Semantic success/danger/warning stay Kumo's defaults — used only for delta
badges and errors (subtle badge variants).

## Contrast (measured, WCAG AA)

| pair                    | light | dark                         |
| ----------------------- | ----- | ---------------------------- |
| default / canvas        | 16.18 | 16.21                        |
| default / elevated      | 17.49 | 14.91                        |
| subtle / canvas         | 5.07  | 7.18                         |
| subtle / elevated       | 5.48  | 6.61                         |
| placeholder / elevated  | 4.67  | 5.13                         |
| control-line / elevated | 3.64  | 3.23 (non-text, ≥3:1)        |
| brand / canvas          | 4.89  | 8.50                         |
| brand-text / elevated   | 5.29  | 7.82                         |
| brand-ink / brand       | 5.29  | 8.50                         |
| brand-text / brand-tint | 4.54  | 6.75                         |
| series-2 / elevated     | 3.25  | 4.33 (data series, not text) |

## Type

- **Display** — `Inter Tight Variable`, weight **400**, letter-spacing
  −0.02em (−0.025em ≥40px). Headings, KPI values, card numbers. Never bold.
- **Body/UI** — `Inter Variable` (Kumo ships system fonts; we load Inter
  explicitly).
- **Mono** — `IBM Plex Mono` 400/500 for `.mono-label`: uppercase 11–12px,
  +0.04em tracking, subtle color — KPI labels, table column headers,
  eyebrows, code, timezone caption. Table numbers stay Inter + `tabular-nums`.

## Shape

- Primary buttons + segmented tabs: pill radius (CSS override; Kumo Button
  exposes no pill variant).
- Cards/Surfaces: 12px radius, 1px line border, `box-shadow: none`.

## Rules

- One accent only: moss green = primary action, selected state, main chart
  series, keyword highlight. Everything else is warm stone.
- Proportion bars use `--color-kumo-tint`; hover deepens to the stronger tint.
- Sidebar: canvas bg, hairline border, active item = tint + brand icon.
- Site: alternating canvas/white bands (96px rhythm), mono eyebrows, ONE
  brand-tint keyword in the hero headline, soft shadow only on the product
  screenshot frame (hairline only in dark).

## Custom pieces (no Kumo equivalent — deliberate exceptions)

- Table proportion bars (`bg-kumo-tint` bar behind each row, sized to share).
- KPI toggle tiles (metric selector: `bg-kumo-tint` + 2px brand top border).
- `.live-dot` pulse for realtime (CSS, suppressed under reduced-motion).
- Sparkline `Chart` config (raw `options` for a minimal visitors line +
  tint area; Kumo TimeseriesChart can't be made minimal cleanly).
- `.mono-label` uppercase metadata text (tokens + CSS, not a component).
