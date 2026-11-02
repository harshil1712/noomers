---
name: brand-tokens
description: The contract for packages/brand (tokens.css, Logo, theme helpers) and how both apps consume it. Use for any color, font, token, theme-mode or logo change.
---

# Brand tokens

`packages/brand` holds the shared shell of the visual identity: `tokens.css`, `Logo.tsx`, `Logo.astro`, `logo.svg`, `theme.ts` (mode helpers).

## tokens.css

- **Warm paper/stone theme** (`light-dark()` pairs per token, resolved via `html[data-mode]` + `color-scheme`): canvas `#F7F6F3`/`#0F0E0D`, white elevated surfaces, warm-stone neutrals, hairlines `#EEEBE6`/`#262422`. **ONE accent** — moss green `#1F7A55`/`#4FC08D` — for the primary action, selected state, main chart series and keyword highlight only. `--brand-ink` = ink drawn on brand surfaces.
- `apps/web/src/index.css` imports `@cloudflare/kumo/styles` then brand tokens; the same file holds the type system (`Inter`/`Inter Tight`/`IBM Plex Mono` via @fontsource), `.mono-label` (uppercase metadata), pill radius overrides for primary buttons/segmented tabs, and the no-card-shadow rule.
- `apps/site/src/styles.css` imports the same tokens + font sources; the site uses plain CSS with `var(--color-kumo-*)`.
- Values + the measured contrast table are documented in DESIGN.md; keep the two in sync.

## Logo

Wordmark only (`Logo.tsx`/`Logo.astro`, `size`/`markOnly` kept for call-site compatibility). Favicon = lowercase "n" on the brand color, SVG + 32px PNG + 180px apple-touch in both apps' public dirs. Don't introduce new logo art.

## Changing the theme

A token change is a cross-app visual change: (1) update `DESIGN.md` — it mirrors tokens.css including the contrast table; (2) run `verify-ui` screenshots in both modes. If a token only makes sense for one surface, don't add it globally.
