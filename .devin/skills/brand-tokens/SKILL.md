---
name: brand-tokens
description: The contract for packages/brand (tokens.css, Logo, theme helpers) and how both apps consume it. Use for any color, font, token, theme-mode or logo change.
---

# Brand tokens

`packages/brand` holds the shared shell of the visual identity: `tokens.css`, `Logo.tsx`, `Logo.astro`, `logo.svg`, `theme.ts` (mode helpers). Kumo's default theme IS the design — no custom colors or fonts.

## tokens.css

- Do NOT add color or font overrides. Only two additions exist: `--brand-ink` (text on `--color-kumo-brand`) and the `color-scheme`/`html[data-mode]` mapping. If a need isn't covered by a `kumo-*` token, fix the component usage rather than inventing a token.
- `apps/web/src/index.css` imports `@cloudflare/kumo/styles` then brand tokens; `apps/site/src/styles.css` does the same for the site's plain CSS.
- Values are documented in DESIGN.md; keep the two in sync.

## Logo

Wordmark only (`Logo.tsx`/`Logo.astro`, `size`/`markOnly` kept for call-site compatibility). Favicon = lowercase "n" on the default brand color, regenerated as SVG + 32px PNG + 180px apple-touch in both apps' public dirs. Don't introduce new logo art.

## Changing the theme

A token change is a cross-app visual change: (1) update `DESIGN.md` — it mirrors tokens.css; (2) run `verify-ui` screenshots in both modes. If a token only makes sense for one surface, don't add it globally.
