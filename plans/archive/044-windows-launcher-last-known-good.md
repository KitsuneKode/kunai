# Plan 044: Preserve the working Windows launcher

> **Drift check:** `git diff --stat 1abbb481..HEAD -- apps/cli/src/services/update/native-installer/launcher.ts apps/cli/test/unit/services/update/native-installer/launcher.test.ts`

**Goal:** A failed Windows launcher upgrade must leave either the previous launcher
at its public path or an explicit recoverable same-directory copy-aside.

## Status

- **Priority:** P0
- **Effort:** S
- **Risk:** MED
- **Planned at:** `1abbb481`, 2026-08-14
- **Completed at:** `22c09d96`, 2026-08-14

## Defect

Windows activation moved the working launcher aside before copying the new binary.
If staging failed, the public launcher disappeared. If moving the launcher aside
failed, the fallback deleted it before attempting the replacement, creating a
second last-known-good loss window.

## Completed tasks

- [x] Stage and chmod the replacement beside the launcher before touching the live
      executable.
- [x] Remove the destructive delete-on-rename-failure fallback.
- [x] Restore the previous launcher if candidate activation fails.
- [x] Retain the copy-aside and report both errors if restoration also fails.
- [x] Cover staging, activation, and restoration failure ordering with deterministic
      unit tests.
- [x] Preserve the existing Unix symlink path and Windows ownership contract.

## Verification

```sh
bun run --cwd apps/cli test -- test/unit/services/update/native-installer/launcher.test.ts
bun run --cwd apps/cli test -- test/unit/services/update/native-installer
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```
