# Plan 039: Preserve network truth and surface search failure

> **Drift check:** `git diff --stat 207ef937..HEAD -- apps/cli/src/services/network apps/cli/src/services/catalog/tmdb-proxy.ts apps/cli/src/app/search apps/cli/src/app/session apps/cli/test/unit/services/network apps/cli/test/unit/services/catalog apps/cli/test/unit/app`

**Goal:** Treat Bun connection failures as offline evidence, keep that evidence
sticky until a successful online operation, and return failed searches to an
actionable search screen instead of silently retrying or appearing to redirect
home.

## Status

- **Priority:** P0
- **Effort:** S
- **Risk:** LOW
- **Planned at:** `207ef937`, 2026-08-14
- **Completed at:** `2472f2cf`, 2026-08-14
- **Evidence:** GitHub issue #20 reports Bun's `Unable to connect. Is the computer able to access the url?` during search.

## Invariants

- Persisted `offlineMode` remains user intent; runtime failures must not write config.
- An offline observation cannot be downgraded by a later timeout. Only a confirmed
  online success restores `online`.
- HTTP/provider failures such as 404 remain provider evidence, not network evidence.
- A failed bootstrap search keeps the query editable, marks search state `error`, and
  does not automatically replay on the next search-phase mount.
- The visible message offers retry and `/offline`; diagnostics keep the original error.

## Tasks

### Task 1: Characterize Bun connection failures and sticky state

- [x] Add the exact issue #20 Bun message to `network-status.test.ts` and
      `tmdb-proxy.test.ts`; expect offline classification and `Search service unreachable`.
- [x] Add a `connectivity.test.ts` case proving `offline -> timeout` stays offline and
      a confirmed search success restores online.
- [x] Run those assertions before implementation and confirm they fail for the
      missing behavior.
- [x] Expand the shared classifiers in `NetworkStatus.ts` and `tmdb-proxy.ts`, then
      make `Connectivity.recordFailure` preserve an existing offline status.

### Task 2: Stop automatic replay and produce actionable feedback

- [x] Add `apps/cli/src/app/search/search-failure-policy.ts` with pure functions that
      decide whether bootstrap search may run and format the failure note from a
      `KitsuneError` plus `NetworkSnapshot`.
- [x] Add `search-failure-policy.test.ts` first. Prove `searchState: "error"`
      suppresses bootstrap replay, idle/loading queries behave intentionally, and an
      offline note contains both `retry` and `/offline`.
- [x] Contain bootstrap failure inside `SearchPhase.ts`, keep the query/state in that
      phase, and pass the failure into BrowseShell's initial error surface.
- [x] Add a render regression that shows the retained query, retry copy, and
      `/offline`, then retries the same query on Enter.
- [x] Convert interactive search rejections into the same actionable BrowseShell
      error while retaining the original failure in structured diagnostics.
- [x] Keep structured failure diagnostics and the raw logged error.

## Verification

```sh
bun run --cwd apps/cli test:file test/unit/services/network/network-status.test.ts
bun run --cwd apps/cli test:file test/unit/services/network/connectivity.test.ts
bun run --cwd apps/cli test:file test/unit/services/catalog/tmdb-proxy.test.ts
bun run --cwd apps/cli test:file test/unit/app/search/search-failure-policy.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/browse-search-failure.useinput.test.tsx
bun run --cwd apps/cli test:file test/unit/app/search/search-phase-offline-bootstrap.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run verify:doc-paths
bun run test
bun run build
```
