# Plan 040: Make support-bundle sections exhaustive

> **Drift check:** `git diff --stat 207ef937..HEAD -- apps/cli/src/services/diagnostics/diagnostic-event.ts apps/cli/src/services/diagnostics/support-bundle.ts apps/cli/test/unit/services/diagnostics`

**Goal:** Ensure every diagnostic category accepted by the runtime can appear in
an exported support bundle without maintaining a second, drifting category list.

## Status

- **Priority:** P0
- **Effort:** S
- **Risk:** LOW
- **Planned at:** `207ef937`, 2026-08-14

## Current defect

`DiagnosticCategory` contains thirteen categories, while `buildBundleSections`
hardcodes nine and silently drops `session`, `search`, `ui`, and `update`.

## Tasks

- [ ] Export one readonly `DIAGNOSTIC_CATEGORIES` tuple from `diagnostic-event.ts`
      and derive `DiagnosticCategory` from `(typeof DIAGNOSTIC_CATEGORIES)[number]`.
- [ ] Add a failing table-driven `support-bundle.test.ts` case with one event per
      category; expect all thirteen section keys in tuple order.
- [ ] Make `buildBundleSections` iterate the shared tuple. Keep omitting categories
      with zero events and retain current privacy and size budgets.
- [ ] Do not add empty per-category configuration or a second allowlist.

## Verification

```sh
bun run --cwd apps/cli test -- test/unit/services/diagnostics/support-bundle.test.ts test/unit/services/diagnostics/diagnostics-export.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
```
