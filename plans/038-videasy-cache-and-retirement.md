# Plan 038: Bound Videasy caches before retiring deprecated routes

> **Drift check:** `git diff --stat 36da54c4..HEAD -- packages/providers/src/videasy packages/providers/test/videasy-*.test.ts apps/cli/test/live/videasy-bloodhounds.smoke.ts .docs/provider-dossiers/videasy.md`

**Goal:** Fix boundedness and identity/cache-policy correctness on active Videasy
paths, then remove deprecated route families only after characterization proves they
cannot be selected or needed for pin migration.

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** MED
- **Planned at:** `36da54c4`, 2026-08-11

## Audit corrections

- The `won` flag around `Promise.any` is not a confirmed bug. It intentionally avoids
  penalizing requests aborted after another host wins. Do not change it without a
  failing concurrency test.
- `classifyVideasyHttpFailure` already documents why 500 is transient; the duplicate
  branch is cosmetic.
- The AES-GCM `wings-tejo` flavor is deprecated and not in the Cineby UI. Its missing
  decoder is not a release blocker unless the flavor is promoted.
- Legacy `api.videasy.to` flavors are marked deprecated/route-dead, but deleting them
  today is riskier than leaving inert code unless pin migration and selection tests
  prove they are unreachable.

## Tasks

### Task 1: Active-path correctness

- [ ] Make `resolveTmdbId` accept only a complete positive decimal identity;
  `123abc`, zero, negative, AniList, and provider-native ids must fail closed.
- [ ] Decide one owner for cache policy. `createVidkingResultFromPayload` currently
  ignores its passed policy and reconstructs one with `apiRoute`. Either create the
  route-specific policy before the call or expose an explicit child-policy function;
  test that read/write/invalidation use the same key.
- [ ] Replace the three Wings Maps with the shared bounded TTL cache or add pruning
  and maximum sizes. Expired seed/preferred-host entries must be deleted on access;
  host failure state is host-bounded.

### Task 2: Prove seed-race semantics

- [ ] Add deterministic tests for primary wins, fallback wins, genuine pre-winner
  failure, loser aborted after winner, all fail, and caller abort.
- [ ] Keep a host penalty only for a genuine failure before a winner. Intentional
  loser aborts must not poison health.
- [ ] Change the `won` logic only if these tests expose an incorrect transition.

### Task 3: Retire dead families separately

- [ ] Add source-contract tests proving deprecated flavor ids normalize for saved
  pins but are never scheduled as active candidates.
- [ ] Run the focused Videasy live suite across active Cineby flavors and record the
  successful endpoints.
- [ ] Delete legacy endpoint/WASM/CryptoJS code only when no active resolver, saved-pin
  migration, fixture, or package export depends on it. Remove dependencies/docs in
  the same commit.
- [ ] Keep `wings-tejo` deprecated or delete the alias. Do not implement AES-GCM for
  a route that product code cannot select.

## Verification

```sh
bun run --cwd packages/providers test test/videasy-client-profile.test.ts test/videasy-flavors.test.ts test/videasy-preferred-fallback.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
KUNAI_VIDEASY_LIVE_SUITE=1 bun run --cwd apps/cli test:live:videasy
```

Cleanup must not share a commit with active-path correctness. If the live suite needs
a deprecated path, mark the retirement task blocked and keep the boundedness fixes.
