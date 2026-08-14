# Plan 041: Jail installer staging cleanup

> **Drift check:** `git diff --stat 207ef937..HEAD -- apps/cli/src/services/update/native-installer/install-layout.ts apps/cli/src/services/update/native-installer/transaction.ts apps/cli/test/unit/services/update/native-installer`

**Goal:** Make every recursive installer cleanup prove structural containment
inside Kunai's staging root before deleting anything.

## Status

- **Priority:** P0
- **Effort:** S
- **Risk:** MED
- **Planned at:** `207ef937`, 2026-08-14
- **Completed at:** `a13e991d`, 2026-08-14

## Current defect

`isInsideStagingRoot` normalizes slashes but does not resolve `.` or `..`. A
persisted abandoned transaction can pass the lexical prefix check while resolving
outside `stagingRoot`, after which cleanup performs recursive `rm`.

## Tasks

- [x] Add table-driven `install-layout.test.ts` cases for POSIX and Windows:
      direct children pass; root, sibling-prefix, and traversal paths fail.
- [x] Compare fully resolved paths with `node:path`/`node:path.win32`; never use
      unresolved `startsWith` as the containment decision.
- [x] Make `removeStagingAndPruneParents` fail closed before its first `rm` when the
      candidate is outside the staging root.
- [x] Add a dead-PID transaction cleanup test with a traversal path and an external
      sentinel; prove cleanup cannot remove the sentinel.
- [x] Keep ordinary version/root pruning behavior on valid staging paths.

## Verification

```sh
bun run --cwd apps/cli test -- test/unit/services/update/native-installer/install-layout.test.ts test/unit/services/update/native-installer/transaction.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```
