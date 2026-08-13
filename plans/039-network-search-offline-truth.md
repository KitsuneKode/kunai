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

- [ ] Add the exact issue #20 Bun message to `network-status.test.ts` and
      `tmdb-proxy.test.ts`; expect offline classification and `Search service unreachable`.
- [ ] Add a `connectivity.test.ts` case proving `offline -> timeout` stays offline and
      a confirmed search success restores online.
- [ ] Run those assertions before implementation and confirm they fail for the
      missing behavior.
- [ ] Expand the shared classifiers in `NetworkStatus.ts` and `tmdb-proxy.ts`, then
      make `Connectivity.recordFailure` preserve an existing offline status.

### Task 2: Stop automatic replay and produce actionable feedback

- [ ] Add `apps/cli/src/app/search/search-failure-policy.ts` with pure functions that
      decide whether bootstrap search may run and format the failure note from a
      `KitsuneError` plus `NetworkSnapshot`.
- [ ] Add `search-failure-policy.test.ts` first. Prove `searchState: "error"`
      suppresses bootstrap replay, idle/loading queries behave intentionally, and an
      offline note contains both `retry` and `/offline`.
- [ ] Use the policy in `SearchPhase.ts`; dispatch `SET_SEARCH_STATE: "error"` in
      the outer failure path.
- [ ] In `SessionController.ts`, dispatch the policy note when SearchPhase returns an
      error before continuing to the next interactive search mount.
- [ ] Keep the existing structured `search.phase.failed` event and raw logged error.

## Verification

```sh
bun run --cwd apps/cli test -- test/unit/services/network/network-status.test.ts test/unit/services/network/connectivity.test.ts test/unit/services/catalog/tmdb-proxy.test.ts test/unit/app/search/search-failure-policy.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```
