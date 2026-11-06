---
name: cleanup
description: Checklist to run before reporting any task as done — stop processes, delete temporary previews/branches/files, remove debug code, leave git clean.
---

# Clean up before you say "done"

Work through every item; report what you removed.

- [ ] **Processes**: stop dev servers, headless browsers, watchers and background jobs you started (`lsof -iTCP -sTCP:LISTEN` on ports you used).
- [ ] **Code**: no debug logging, `console.log`, temporary flags, commented-out code, TODOs you introduced, unused imports/exports/files/deps (`vp check` passes).
- [ ] **Files**: delete scratch files, temp screenshots, generated artifacts not meant for git; nothing written outside the repo except under `/tmp`.
- [ ] **Git**: `git status` clean; delete local branches/worktrees you created that are merged or abandoned. Never delete branches you didn't create.
- [ ] **Cloud**: delete Worker Previews you created that are no longer needed. Any other resource you created by mistake → report it; don't delete shared or production resources yourself.
