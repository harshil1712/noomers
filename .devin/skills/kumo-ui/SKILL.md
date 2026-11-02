---
name: kumo-ui
description: Build UI in apps/web with Cloudflare Kumo. Use for any component, route, layout, form, table, dialog, menu or state change in apps/web/src (apps/site may borrow the design tokens only — see brand-tokens).
---

# Kumo UI

`apps/web` is built on `@cloudflare/kumo` (Base UI + Tailwind 4). The component source of truth is the vendored docs: `apps/web/node_modules/@cloudflare/kumo/ai/USAGE.md` (read it) and `ai/component-registry.md`. Per-component API:

```bash
cd apps/web && npx kumo doc <Component>   # e.g. npx kumo doc Dialog
```

## Hard rules

- **Kumo components first** — Button, Input, Field, Select, Dialog, DropdownMenu, Table, Tabs, Empty, Surface, Text, Loader, Badge, Banner, Combobox, Checkbox. Never import shadcn, Radix, raw Base UI, or add another UI library.
- **Semantic tokens only** — `bg-kumo-*`, `text-kumo-*`, `border-kumo-*` etc. Never raw Tailwind palette classes (`bg-blue-500`, `text-gray-600`) or hex values. Brand overrides live in `packages/brand/tokens.css` (see `brand-tokens`).
- **No `dark:` variants** — light/dark is handled by `light-dark()` in tokens. Ever.
- **`cn()` from `@cloudflare/kumo`** for class merging.
- **Compound APIs** — `<Dialog.Root>/<Dialog.Trigger>`, `<DropdownMenu.Trigger>/<.Content>/<.Item>`, etc. Follow `kumo doc`.
- **Icons: Phosphor only** (`@phosphor-icons/react`). Pass `size={16}` (inline/buttons) or `size={20}` (nav); `weight="fill"` for active nav items — use `weight="fill"` for active states.
- **States** — empty → `Empty`, loading → `Loader` (or `Button loading`), errors inline via `Field`/`Input` `error` prop; page-level failures → `Banner`. Toasts via `lib/toast.ts` (`toast.success/error/info/warning(title, description?)`).
- **Forms** — `Field` wraps inputs: `label`, `description`, `error`, `required` props; validation errors go to `error`, not ad-hoc red text.

## Existing patterns to copy

- Top-bar app shell, theme toggle: `src/components/app-shell.tsx`, `theme-toggle.tsx` (theme via `lib/theme.ts`)
- User menu: `components/user-menu.tsx`; page headers: `page-header.tsx`; settings blocks: `settings-section.tsx`
- Shared: `confirm-dialog.tsx`, `form-error.tsx`, `auth-link.tsx`, `google-sign-in.tsx`, `password-input.tsx`, `status-badge.tsx`, `router-link.tsx`
- Auth screens (card layout, captcha slot, error display): `auth-card.tsx`, `src/routes/sign-in.tsx`; error copy via `lib/auth-errors.ts`, form state via `lib/use-captcha-form.ts`/`useDocumentTitle`
- Admin users table + row actions: `src/routes/_authed/admin.tsx`
- Settings forms (Field usage): `src/routes/_authed/settings.tsx`

Check your diff against the hard rules before reporting — `dark:`, raw colors and non-Kumo components are violations to fix, not to copy.
