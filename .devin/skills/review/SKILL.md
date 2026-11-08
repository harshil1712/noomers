---
name: review
description: Review a PR or diff and give a ship / rework verdict with concrete findings. Use before every merge and as a self-check before opening a PR.
---

# Review a change

Read the full diff (`gh pr diff <n>` or `git diff main...HEAD`) and the PR evidence. Judge against this list; every finding needs a file:line and a concrete fix.

## Correctness
- Does it do what the brief asked, nothing more? Edge cases (empty, error, unauthenticated)?
- Tests cover the behaviour change and would fail without it. No tests weakened, skipped or deleted to go green.
- Errors handled at the right boundary; API errors stay JSON `{error: message}`.

## Safety
- No secrets, tokens or personal data in code, logs, fixtures or screenshots.
- Auth: every new route checks session/admin as appropriate.
- Infra changes only in `alchemy.run.ts`; no production deploy path outside CI.

## Quality (anti-slop)
- No speculative abstractions, dead code, commented-out code, `any` escapes, non-null assertions or catch-all try/catch without reason. `vp check` must pass with the anti-slop rules.
- Matches surrounding conventions; names say what things are.
- UI: `kumo-ui` rules hold (Kumo components, `kumo-*` tokens, no `dark:`, no raw colors, Phosphor icons) and `verify-ui` was run — screenshots + detector findings attached.
- Dependencies: necessary, pinned, 7-day rule respected.

## Evidence
- CI green; preview URL works for the changed behaviour; screenshots for UI.
- Cleanup done (no stray files, previews, debug logs).

## Output
A table: `| Severity | File:line | Finding | Fix |` (severity: blocker / should-fix / nit), then a one-line verdict: **ship** or **rework**. Blockers or missing evidence → rework.
