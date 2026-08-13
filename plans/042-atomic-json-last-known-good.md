# Plan 042: Preserve the last-known-good atomic-write target

> **Drift check:** `git diff --stat 207ef937..HEAD -- apps/cli/src/infra/fs/atomic-write.ts apps/cli/test/unit/infra/fs`

**Goal:** Make Windows replacement failures preserve the previous valid config,
token, metadata, or support-bundle file.

## Status

- **Priority:** P0
- **Effort:** M
- **Risk:** MED
- **Planned at:** `207ef937`, 2026-08-14

## Current defect

On Windows `EPERM`, `EEXIST`, or `ENOTEMPTY`, `atomicMove` unlinks the target and
then retries the rename. If that rename fails, the old target is already gone.

## Tasks

- [ ] Refactor filesystem operations behind a package-private injected adapter so
      failure ordering is testable without replacing `process.platform`.
- [ ] Add `apps/cli/test/unit/infra/fs/atomic-write.test.ts` covering normal replace
      and the Windows fallback.
- [ ] Prove a failed replacement leaves the original bytes readable and cleans temp
      files.
- [ ] Replace through a same-directory backup; remove it only after success and
      restore it if installing the temp file fails.
- [ ] If restoration fails, retain the backup and throw both failure contexts.
- [ ] Preserve pre-rename `0o600` on POSIX secret writers and all public APIs.

## Verification

```sh
bun run --cwd apps/cli test -- test/unit/infra/fs/atomic-write.test.ts test/unit/infra/storage/FileStorage.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```
