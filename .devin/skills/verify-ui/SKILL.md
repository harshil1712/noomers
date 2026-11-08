---
name: verify-ui
description: The UI gate — screenshots at 1280 desktop + 390 mobile, light and dark, for every changed route, plus the impeccable detector and an a11y pass. Run before any PR touching apps/web/src, apps/site or packages/brand.
---

# Verify UI — the gate

## Capture

1. Dev server: `vp run dev` (alchemy dev; needs CF env creds — see README) or `vp build` + `wrangler dev --config wrangler.local.jsonc` in apps/web. Site: `npx astro preview` in apps/site after `astro build`.
2. For every changed route capture 4 shots with `agent-browser`:
   - desktop 1280 light + dark: `npx agent-browser set viewport 1280 900`, open the URL, `npx agent-browser eval "localStorage.setItem('noomers-theme','light'|'dark');document.documentElement.setAttribute('data-mode','light'|'dark')"`, `npx agent-browser screenshot /tmp/<route>-<mode>.png`
   - mobile 390: `set viewport 390 844` — at least one mode per route.
   - Pixel-check the image isn't blank (don't trust a 0-byte/dark-file alone — compare light vs dark means).
3. CI: the preview deployment is the equivalent — link it in the PR.

## Review

- Run the detector on changed UI files (or the URL): `npx impeccable detect <path-or-url>` (exit 2 = findings; fix or justify each).
- a11y pass: `accesslint` skills if installed (`npx skills add accesslint/skills`), else the web-design-guidelines a11y rules: heading order, labels on form controls, focus visible, color contrast, no icon-only buttons without accessible names, keyboard navigation works.
- Open every screenshot: real content, no overflow/clipped text, Kumo tokens only, both modes legible, mobile stacks cleanly, copy sentence case.
Fix and re-capture until clean. Attach screenshots + findings to the PR.

## Clean up

Stop dev server and browser; delete temp screenshots (never commit them).
