# Plan 048: Make download disk admission deterministic in unit tests

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/services/download/DownloadService.ts apps/cli/test/unit/services/download/download-service.test.ts`
> Mismatch → re-read `evaluateStorageForPath` and the `deps` constructor block before proceeding.

Closes #238.

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** LOW — adds an injectable seam; production behavior identical
- **Depends on:** none
- **Category:** tests
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`DownloadService.enqueue` runs a real `statfs` against the download directory.
On a host whose volume has less free space than the offline safety reserve,
the suite fails with `insufficient-disk` regardless of the change under test —
verified on clean `main` at `9d946648` in two checkouts with `/tmp` at ~3.0 GB.
A unit suite whose verdict depends on ambient disk state is a false-red
machine, and it hides that the admission check is genuinely live.

## Current state

`apps/cli/src/services/download/DownloadService.ts` imports `statfs` directly:

```ts
// DownloadService.ts:1
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
```

and calls it at two sites:

```ts
// :539 — estimateAvailableEpisodeSlots
const diskStats = await statfs(baseDir);

// :1894 — inside evaluateStorageForPath (pre-flight admission used by enqueue)
const diskStats = await statfs(dirname(outputPath));
```

The deps object (`DownloadService.ts:294-309`) is an inline literal — every
external seam is already injected there (`repo`, `config`, `ytDlpAvailable`,
`ffprobeDeadline`, `diagnostics`, …). `statfs` is the only filesystem probe not
behind it.

Test seam that already exists:
`apps/cli/test/unit/services/download/download-service.test.ts` `buildService()`
forwards each dep key individually and defaults
`offlineFreeSpaceReserveBytes: 0` in `defaultConfig`. The failing test is
"attributes a failed second claim after another process wins the first job"
(~line 1865) — it calls `service.enqueue(...)`, which reaches the real
`statfs` at :1894 via `evaluateStorageForPath`.

The repo's test-seam convention: optional function deps with a production
default — same shape as `ffprobeDeadline?: DeadlineFactory` and
`resolveDownloadStream?` in the same deps block.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused test | `bun run --cwd apps/cli test:file test/unit/services/download/download-service.test.ts` | all pass |
| Full suite | `bun run test --force` | 0 failures |
| Typecheck | `bun run typecheck --force` | exit 0 |
| Lint/fmt | `bun run lint --force && bun run fmt` | exit 0 |

Use `bun run test`, never `bun test` at the root. `--force` bypasses the turbo
cache — a green cached replay is not evidence (AGENTS.md hazard #2).

## Scope

**In scope:**
- `apps/cli/src/services/download/DownloadService.ts`
- `apps/cli/test/unit/services/download/download-service.test.ts`

**Out of scope:**
- The reserve policy itself (`offlineFreeSpaceReserveBytes`, `estimateAllowedNewAssets`) — correct as-is.
- `packages/storage` — no repository changes needed.
- Any other test file. If other tests are discovered to depend on host disk, note them in the PR body but do not expand scope.

## Steps

### Step 1: Add a volume-stats dep to `DownloadService`

In the `deps` literal at `DownloadService.ts:294`, add:

```ts
readonly statfs?: (path: string) => Promise<{ bavail: number; bsize: number }>;
```

Add a private accessor that defaults to the node implementation:

```ts
private statfs(path: string) {
  return (this.deps.statfs ?? statfs)(path);
}
```

Replace both call sites (`:539`, `:1894`) with `await this.statfs(...)`. Keep
the returned-shape use (`diskStats.bavail * diskStats.bsize`) unchanged.

**Verify:** `bun run --cwd apps/cli typecheck` → exit 0.

### Step 2: Inject the seam in `buildService`

In `download-service.test.ts`, add a `statfs` parameter to `buildService` and
forward it into `new DownloadService({...})`. Default it to a stub returning a
large volume — e.g. `{ bavail: 1 << 40, bsize: 4096 }` — so *every* unit test
runs against deterministic headroom, not just the one that failed. Tests that
exercise the reserve (e.g. "rechecks disk capacity before starting queued
work", ~:411) already control `reserveBytes` through `configService` and are
unaffected.

**Verify:** the focused test command above → all pass.

### Step 3: Prove the flake is gone and the guard still bites

1. Assert determinism: temporarily set the stub to return `bavail: 0` in a new
   test asserting `enqueue` rejects/pauses with `insufficient-disk` — this is
   the behavior that previously depended on the host.
2. Run the file's suite twice; no `insufficient-disk` failure anywhere else.

**Verify:** `bun run --cwd apps/cli test:file test/unit/services/download/download-service.test.ts` → all pass, including the new stubbed-low-space test.

### Step 4: Changeset + gates

This is test-infra/deps-only — no user-facing change, no changeset needed.
Run the full gates in the Commands table.

## Test plan

- New test: enqueue with stubbed `bavail: 0` (or below reserve) →
  `insufficient-disk` pause message. Model after the existing
  "rechecks disk capacity before starting queued work" test (~:411).
- Regression: the "attributes a failed second claim…" test now passes on any
  host volume state.

## Done criteria

- [ ] `statfs` in `DownloadService.ts` is only called through `this.deps.statfs ?? statfs`
- [ ] `buildService` injects a high-headroom stub by default
- [ ] New stubbed-low-space test exists and passes
- [ ] `bun run test --force` exits 0 with no `insufficient-disk` flakes
- [ ] `bun run typecheck --force` and `bun run lint --force` exit 0

## STOP conditions

- `evaluateStorageForPath` no longer calls `statfs` (someone else injected the
  seam or moved the check) — reconcile rather than adding a second seam.
- The deps object was refactored into a named interface — same change, updated
  shape; not a blocker, but re-verify all constructor call sites compile.

## Maintenance notes

- If more filesystem probes land in this service (`stat`, `mkdir` failures),
  prefer routing them through the same dep block rather than importing from
  `node:fs/promises` at module scope.
- A reviewer should check the stub default is generous enough that no test
  silently stops exercising the admission path — `bavail: 1 << 40` keeps
  `estimateAllowedNewAssets` on its happy path.
