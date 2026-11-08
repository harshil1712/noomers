---
name: ship-pr
description: Implement one scoped task on a branch, verify it, and open a PR with evidence. Use for every code change.
---

# Ship one PR

## Before coding
- `vp install`. Read `AGENTS.md` and the files named in your brief. Follow existing patterns; mimic naming, structure and libraries.
- If the brief leaves a design decision open, stop and ask instead of guessing.

## While coding
- One concern per PR. No drive-by refactors, no new abstractions you don't need, no commented-out code.
- Behaviour change → add or update a test in the same PR (`apps/web/tests`).
- New dependency → `vp add`; it must satisfy the 7-day rule. If it doesn't, report it.
- UI → Kumo components and Kumo tokens only (no raw Tailwind colours), sentence-case copy, light + dark.
- Never touch production config, secrets or `alchemy.run.ts` resources unless the brief says so.

## Verify (run them; paste real output)
1. `vp check` (format, lint incl. anti-slop rules, types)
2. `vp run -r test`
3. `vp run -r build`
4. UI changes: `verify-ui` screenshots.
5. Push the branch; CI deploys a Worker Preview. Open the preview URL and exercise the change. Record what you checked.

## Open the PR
`gh pr create` against `main`, title in plain words. Body:
- **What & why** (2-4 bullets)
- **Evidence**: commands + results, screenshots, preview URL + what you tested
- **Risk**: what could break, how it's covered

## Finish
Run `cleanup`. Hand back: PR URL, head SHA, CI/review state, preview URL, open questions.
