# Design system — Pixel crew, flare brand

Component library: `@cloudflare/kumo` (apps/web). Brand layer: `packages/brand`:

| Export                       | What                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `tokens.css`                 | every colour/font token, Kumo overrides, `.font-display` |
| `logo-cells`                 | the logo's 8×10 cell map (single source)                 |
| `Logo.tsx` / `Logo.astro`    | mark + lowercase wordmark, rendered from `logo-cells`    |
| `logo.svg`                   | static mark (resolved light values)                      |
| `theme`                      | theme persistence + boot script (both apps)              |
| `crew/crew`, `crew/crew.css` | sprite art + vanilla/Astro renderer + motion CSS         |
| `crew/CrewSprite`            | React sprite built from the same art                     |

## Tokens

`packages/brand/tokens.css` declares everything once inside `light-dark()`. No `dark:` classes anywhere. It's unlayered on `:root`, so it beats Kumo's `@layer base` and `@theme` defaults (including Kumo's `:root[data-mode="dark"]` block) without `!important`. Apps reference tokens by name and never by resolved hex.

### Surfaces and neutrals (warm, not Kumo's 0-chroma grey)

| Token                       | Light     | Dark      | Used by (Kumo)                                 |
| --------------------------- | --------- | --------- | ---------------------------------------------- |
| `--color-kumo-canvas`       | `#FBFBF9` | `#131211` | page                                           |
| `--color-kumo-elevated`     | `#FFFFFF` | `#1B1A18` | raised surfaces, compact table header          |
| `--color-kumo-recessed`     | `#F3F4F5` | `#22201E` | wells, segmented tabs, mobile scrim            |
| `--color-kumo-base`         | `#FFFFFF` | `#1B1A18` | LayerCard, Popover, Dialog, Select popup, `th` |
| `--color-kumo-control`      | `#FFFFFF` | `#22201E` | Input, Select trigger, DropdownMenu            |
| `--color-kumo-overlay`      | `#F3F4F5` | `#2E2B28` | disabled fields, chips                         |
| `--color-kumo-tint`         | `#F2F1ED` | `#292724` | hover / highlighted items, active nav          |
| `--color-kumo-fill`         | `#E7E7E3` | `#2E2B28` | `th` rule, card rings                          |
| `--color-kumo-fill-hover`   | `#F2F1ED` | `#383532` |                                                |
| `--color-kumo-line`         | `#E7E7E3` | `#2E2B28` | decorative borders (cards, sidebar)            |
| `--color-kumo-hairline`     | `#EDECE8` | `#292724` | separators                                     |
| `--color-kumo-interact`     | `#D6D3CE` | `#45413C` | checked card borders                           |
| `--color-kumo-contrast`     | `#121212` | `#F3F1EE` | checked checkbox                               |
| `--color-kumo-focus`        | `#22201E` | `#EBE8E3` | focus ring (non-brand)                         |
| `--color-kumo-control-line` | `#8A857E` | `#75706A` | input / select borders (≥3:1, see below)       |

### Text (Kumo's `--text-color-kumo-*` namespace, which drives `text-kumo-*`)

| Token                                                                 | Light     | Dark                      |
| --------------------------------------------------------------------- | --------- | ------------------------- |
| `--color-kumo-default` → `--text-color-kumo-default`                  | `#121212` | `#F3F1EE`                 |
| `--text-color-kumo-strong`                                            | `#0B0B0A` | `#FBFAF8`                 |
| `--color-kumo-subtle` → `--text-color-kumo-subtle`                    | `#5F6368` | `#A39E97`                 |
| `--text-color-kumo-placeholder`                                       | `#77726B` | `#8F8982`                 |
| `--text-color-kumo-inactive`                                          | `#A8A39C` | `#6B665F` (disabled only) |
| `--text-color-kumo-inverse`                                           | `#F3F1EE` | `#121212`                 |
| `--text-color-kumo-brand` = `--text-color-kumo-link` = `--brand-text` | `#B8360F` | `#FF7A55`                 |
| `--brand-text-hover`                                                  | `#8F2A0B` | `#FF9C7A`                 |

### Brand

| Token                      | Light     | Dark      | Notes                                         |
| -------------------------- | --------- | --------- | --------------------------------------------- |
| `--color-kumo-brand`       | `#C73D19` | `#FF6B42` | primary fills, focus-visible ring, `--crew-1` |
| `--color-kumo-brand-hover` | `#A9330F` | `#FF8A66` | darker in light, lighter in dark              |
| `--brand-ink`              | `#FFFFFF` | `#121212` | text/icons on a brand fill                    |
| `--brand-text`             | `#B8360F` | `#FF7A55` | brand-coloured text and links                 |
| `--brand-lite`             | `#F08C66` | `#8A3418` | logo core                                     |
| `--brand-tint`             | `#FBE3DC` | `#3A1D14` | soft brand backgrounds                        |
| `--highlight`              | `#FFC53D` | `#FFC53D` | the logo's highlight pixel, crew accents      |

### Status (badge tints)

The site's `.bg.*` badge classes live in the site CSS. Only the colours are shared.

| Token                     | Light                 | Dark                  |
| ------------------------- | --------------------- | --------------------- |
| `--status-active-bg/fg`   | `#E2F5EC` / `#18794E` | `#12301F` / `#5FD49A` |
| `--status-paused-bg/fg`   | `#F3F4F5` / `#5F6368` | `#24221F` / `#B3ADA5` |
| `--status-archived-bg/fg` | `#FDE4E4` / `#B3261E` | `#3A1A14` / `#FF8A6E` |

### Crew

| Token              | Light                 | Dark                  |
| ------------------ | --------------------- | --------------------- |
| `--crew-1`         | = brand               | = brand               |
| `--crew-2`         | `#E8A33D`             | `#E8A33D`             |
| `--crew-3`         | `#7C8DA6`             | `#8FA3BE`             |
| `--crew-4`         | `#55575C`             | `#A9A9A9`             |
| `--crew-legs`      | `#121212`             | `#8A847C`             |
| `--crew-eye`       | `#FFFFFF`             | `#FFFFFF`             |
| `--crew-accent`    | = `--highlight`       | = `--highlight`       |
| `--crew-tag-bg/fg` | `#121212` / `#FFFFFF` | `#F3F1EE` / `#121212` |

### Contrast (WCAG 2.x, measured)

All text tokens pass AA (≥4.5:1) on canvas, elevated and recessed in both modes:

| Pair                              | Light canvas / white / recessed | Dark canvas / elevated / recessed |
| --------------------------------- | ------------------------------- | --------------------------------- |
| default text                      | 18.1 / 18.7 / 17.0              | 16.6 / 15.4 / 14.4                |
| strong text                       | 19.0 / 19.7 / —                 | 17.9 / 16.7 / —                   |
| subtle text                       | 5.84 / 6.05 / 5.49              | 7.03 / 6.54 / 6.10                |
| brand-text / link                 | 5.67 / 5.88 / 5.34              | 7.28 / 6.76 / 6.31                |
| link hover (`--brand-text-hover`) | 8.09 / 8.39 / —                 | 9.17 / 8.52 / —                   |
| placeholder (on control)          | 4.60 / 4.77 / —                 | 5.41 / 5.03 / 4.69 (control bg)   |
| inactive (disabled, exempt)       | ≈2.4                            | ≈3.3                              |

Text on brand fills: light `#FFF` on `#C73D19` **5.11**, on hover `#A9330F` **6.63**. Dark `#121212` on `#FF6B42` **6.63**, on hover `#FF8A66` **8.10**.

Non-text (1.4.11), `--color-kumo-control-line`: light 3.66 on white, 3.53 on canvas, 3.32 on recessed. Dark 3.55 on elevated (inputs on cards), 3.82 on canvas, 3.31 on control/recessed.

## Buttons

- **Primary** = Kumo `Button variant="primary"`: a **flat** `--color-kumo-brand` fill with `--brand-ink` text, and hover goes to `--color-kumo-brand-hover`. No gradient. Kumo injects its emphasis gradient as an inline style, so `apps/web/src/index.css` carries one documented, element-scoped override for primaries (the only Kumo patch besides control borders and the plain-link hover). Don't add more.
- Use one primary per view. Everything else is `secondary`, `ghost` or `outline`. Destructive actions use `secondary-destructive`, or `destructive` inside a confirm dialog.
- A full-width button needs `w-full justify-center`.
- The site's `.btn` mirrors this: a brand fill with `--brand-ink`, and hover uses `--color-kumo-brand-hover`.

## Theme

`@noomers/brand/theme` is the only theme logic in both apps:

```ts
THEME_STORAGE_KEY            // "noomers-theme"
type ThemeMode = "light" | "dark" | "system"
readTheme(): ThemeMode       // saved value, else "system"
resolveTheme(mode): "light" | "dark"
applyTheme(mode): void       // sets <html data-mode>, persists ("system" clears), follows OS while "system"
THEME_BOOT_SCRIPT: string    // inline <head> script, runs before first paint
```

`html[data-mode]` sets `color-scheme`, and `light-dark()` does the rest.

## Type

- Display and body: **Instrument Sans** (`@fontsource-variable/instrument-sans`). `--font-display` is the same family. `.font-display` only tightens tracking (`-0.015em`) for headings of 20px and up.
- Code and mono: **JetBrains Mono** (`@fontsource-variable/jetbrains-mono`).
- **Pixelify Sans** (`@fontsource/pixelify-sans`, `.font-pixel`) is for sprite carry labels only. Never use it for headings (404s included), body text or numbers.

## Logo

A pixel-flame mark on an **8×10** cell grid: a pointed tip, a `--brand-text` base, a `--brand-lite` core and one `--highlight` pixel. All other cells are `--color-kumo-brand`. The cell map lives in `logo-cells.ts`. `Logo.tsx` and `Logo.astro` render it with token fills (so it follows the mode), and `logo.svg` is the static light rendering. It's crisp at 16, 24 and 32px. Use `<Logo wordmark />` for the wordmark everywhere; don't restyle it inline.

## Crew sprites

The art has one source: `CREW_SILHOUETTES` in `crew/crew.ts`.

- Site / vanilla: `crewHTML(robot, colorVar, carry, flip, cls)` + `crew.css` (`.sp`, steps() animations).
- React: `<CrewSprite robot={0..3} color="--crew-2" size={48} carry="label" flip className />`. It's a static SVG with `crispEdges` and `aria-hidden`, and it draws eyes, accents and legs from `--crew-eye`, `--crew-accent` and `--crew-legs`.

Rules:

- Sprites are decorative only (`aria-hidden`). Never put them over content or text, and never put meaning in one. Show at most one cluster per screen.
- **Marketing site (Persuade):** playful is fine. The hero crew, cheers and the gutter escort (≥1400px only) must never block a CTA or navigation and must never hide the cursor.
- **App (Operate):** only in empty states (`Empty`), the 404 page and the auth card. No decorative hover easter eggs, pointer-following or animation anywhere in working UI.
- Motion: steps() jump/step only, animate transform/opacity, static under `prefers-reduced-motion`, and no pointer-follow on touch.

## Surfaces

- `apps/web` (Operate): Kumo components first, `kumo-*` tokens only.
- `apps/site` (Persuade): plain CSS on the same tokens. The hero shows the app window mock with the crew walking along its bottom edge.
- `/blog/*` (Read): `.prose` typography.

Hard rules: use Kumo components before custom ones. Use semantic `kumo-*` and brand tokens, never raw palette classes or hex in app code. Merge classes with `cn()` from `@cloudflare/kumo`. Use Phosphor icons only for UI icons (crew sprites are art, not icons).

## Theme

Light/dark preference is stored per origin (localStorage) — the site and the app are different origins in prod and dev, so a choice on one does not carry to the other. This is by design.
