# noomers design system

Kumo (`@cloudflare/kumo`) IS the design system. No custom palette, no custom
type, no concept art — the product looks like the component library it ships
with: light and dark via `html[data-mode]` + `light-dark()`, theme toggle
provided by the app and site.

## Tokens

`packages/brand/tokens.css` defines only:

- `--brand-ink: light-dark(#fff, #121212)` — text drawn on `--color-kumo-brand`
  surfaces (Kumo's default brand is orange; white ink on light, near-black on dark).
- `color-scheme` mapping so `html[data-mode]` drives `light-dark()`.

Everything else — canvas/elevated/recessed surfaces, line/hairline/control,
default/subtle/placeholder text, brand, danger, success, chart palette —
comes from `@cloudflare/kumo/styles`. Never add a brand color, font, or
semantic token back to this file; a one-off need is either an existing
`kumo-*` token you haven't found yet, or a component bug to fix upstream.

## Type

Kumo's default stack only. Numbers get `tabular-nums` where they are data
(stat values, table counts, chart axes). Headings use the `Text` component
(`variant="heading1|2|3"`, `as="h1…h6"`), body uses `variant="body|secondary"`,
code uses `Code`/`Code.Block`.

## Logo

Wordmark only: lowercase "noomers" in semibold Kumo text (`Logo.tsx` /
`Logo.astro`, `size`/`markOnly` props kept for call-site compatibility).
Favicon: lowercase "n" in white on a rounded square of Kumo's default brand
(`favicon.svg`, 32px PNG, 180px apple-touch — both apps).

## App patterns

- **Shell:** Kumo `Sidebar` (`collapsible="icon"`): wordmark header, Sites
  group (one `Globe` item per registered site), "Add site" Dialog explaining
  the Sites API, footer Settings/Admin(theme toggle, user menu).
  `CommandPalette` on Cmd/Ctrl+K for site/Settings/Admin jumps.
- **Dashboard header:** Breadcrumbs (Sites / domain), domain title + external
  link icon, segmented `Tabs` (Overview | Realtime), interval `Select`,
  "Tracking code" `Dialog` with `Code.Block` snippets; filter `Badge` row.
- **KPI strip:** one `Surface`, `Grid` of tiles — live-visitors tile first
  (pulsing `.live-dot` — the only allowed custom CSS, suppressed under
  `prefers-reduced-motion`), then the stats endpoint's metrics in
  `tabular-nums`. Change badges only when the API returns previous values.
- **Breakdowns:** `Grid variant="2up"` of `Surface` panels; header = `Text
  heading3` + `Tabs variant="underline"`; body = `Table layout="fixed"` Name |
  count | %, with a `bg-kumo-tint` proportion bar behind each name; rows are
  keyboard-focusable filter controls; `Pagination`-style prev/next footer.
- **Chart:** `TimeseriesChart` + `ChartPalette.categorical(i, isDark)` +
  `ChartLegend` items.
- **Realtime tab:** `Surface` hero count + 2up tiles + `Table`s for
  topPages/topReferrers straight from the DO payload.
- **States:** skeleton blocks for loading; ONE `Banner variant="error"` when
  ≥3 historical fetches fail (Basin SQL down), with a `Retry` `Button`;
  per-panel failure stays a small inline message; `Empty` with `commandLine`
  snippets for no-data/no-sites.
- **Auth screens:** centered `Surface`, wordmark above, `Field`/`Input`/
  `SensitiveInput`, plain headings ("Sign in to noomers", "Create your
  account", "Reset your password", "Check your email").

## Site patterns

Same tokens and fonts via `@import "@cloudflare/kumo/styles/tailwind"`;
plain Astro + tokens, no React components. Conventional marketing page:
nav (wordmark · Docs · Blog · GitHub · Deploy button), hero with a real
dashboard screenshot (`<picture>` for light/dark), "what it stores / never
stores" columns, architecture flow, deploy steps, API subset, script snippet.

## Motion

Exactly one custom animation: `.live-dot` pulse on the realtime indicators,
suppressed under `prefers-reduced-motion`. Everything else is Kumo's own
transition set.
