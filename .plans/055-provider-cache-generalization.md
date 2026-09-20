# Plan 055: Generalize the provider cache port to the remaining providers

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- packages/types/src/index.ts packages/providers/src/vidlink/ packages/providers/src/anidb/ packages/providers/src/hianime/ packages/providers/src/rivestream/ packages/storage/src/repositories/provider-cache.ts`
> Mismatch → re-check which providers already adopted `context.cache`.

Closes the residue of #205 (the port + Miruro landed in merged PR #206;
warm-on-search landed in `SearchPhase.ts`).

## Status

- **Priority:** P3
- **Effort:** M
- **Risk:** MED — the failure mode is caching something short-lived (signed URLs) and serving rotten data; the plan's whole discipline is *what may be cached*
- **Depends on:** none (port already shipped)
- **Category:** perf
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`ProviderCachePort` exists (`packages/types/src/index.ts:502`, wired at
`ProviderRuntimeContext.cache` :633, backed by `provider-cache.ts` in
`packages/storage`). Only allmanga and miruro use it — every other provider
still re-pays cold network costs each session. Measured evidence from the
issue: cold Miruro resolve of One Piece = 12,188ms, two ~6s Cloudflare-gated
calls; warm = 0ms. Each provider migrated removes its own version of that tax.

## Current state

```ts
// packages/types/src/index.ts:502
export interface ProviderCachePort { ... }   // read/write keyed by namespace + CacheTtlClass
```

Users today: `allmanga/api-client.ts`, `miruro/direct.ts`. Non-users:
`vidlink`, `anidb`, `hianime`, `rivestream`, `videasy`, `youtube`.

**What may and may not be cached** (from the issue — the hard rule):
- ✅ Episode lists/catalogs, id mappings, external-id lookups, manifest
  *structure* — stable, TTL-classable.
- ❌ Resolved stream URLs, signed cookies, `enc-dec` outputs beyond their own
  TTL — signed/short-lived; leave in-memory (5min) until proven stable. The
  VidLink cookie trap is cited in the issue.

Candidates with real value, by provider:

- **anidb**: `fetchAnidbMalId`/`fetchAnidbExternalIds` + `malCache`
  (`anidb/client.ts:320-327`) — process-local Map today; MAL/external ids are
  effectively immutable → strong cache candidate. HTML browse pages — moderate
  TTL.
- **vidlink**: DASH manifest *metadata* if stable across sessions (verify
  expiry); `enc-dec` results already have a TTL'd in-memory cache
  (`encDecCache` :226) — persisting within its own TTL window is legitimate.
- **hianime/rivestream**: episode catalogs — same shape as miruro's win.
- **videasy**: catalog/session-adjacent metadata only; the session token
  itself is config, not cache.
- **youtube**: metadata via yt-dlp is slow; `youtube-metadata-cache` repo may
  already exist — check `packages/storage/src/repositories/youtube-metadata-cache.ts`
  before doing anything; if it exists, youtube is already served and this plan
  just confirms it.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Provider tests | `bun run --cwd packages/providers test` | all pass |
| Storage tests | `bun run --cwd packages/storage test` | all pass |
| Full suite | `bun run test --force` | 0 failures |
| Typecheck | `bun run typecheck --force` | exit 0 |

## Scope

**In scope:**
- Provider adapters' *stable-data* reads routed through `context.cache`
- `packages/providers/test/` — cache-hit/miss/TTL-expiry tests per migrated call
- `.docs/providers.md` — cache-port guidance: what may be persisted (with the signed-URL rule)
- `.changeset/` — patch

**Out of scope:**
- Changing the port's shape or the `provider_cache` schema (landed, works).
- Caching stream URLs or signed credentials — explicitly rejected.
- Warm-on-search for other providers (already exists for anime top result; extending it is a separate UX call).
- Migrating existing in-memory caches' *keys* — adopt `cachePolicy`-compatible keys; do not import old Maps' contents.

## Steps

### Step 0 (audit gate): list every candidate and its TTL class first

Before touching code, produce the migration table in the PR description:
per provider, each cacheable read → its TTL class (match `CachePolicy`/`CacheTtlClass`
vocabulary in `packages/types`), and the one-line justification that it's
stable data. **Any row that can't justify stability stays in-memory — that is
the accepted answer, not a gap.** Get this table right and the rest is
mechanical.

**Verify:** the table exists in the PR body before code lands (reviewer gate).

### Step 1: AniDB external-id persistence

Move `malCache` (`anidb/client.ts:320-327`) reads/writes through
`context.cache` with a long TTL (external ids are immutable — weeks, not hours).
Keep the in-process Map as L1 if the port has meaningful latency; otherwise
drop it — simpler is better.

**Verify:** new unit test — second call does not re-fetch after simulated
process restart (fresh Map, seeded cache port).

### Step 2: Remaining providers per the audit table

Repeat per provider row: episode catalogs for hianime/rivestream
(12h-ish per the issue's miruro precedent — confirm `CacheTtlClass` options),
enc-dec persistence-within-TTL for vidlink. One provider per commit.

**Verify:** `bun run --cwd packages/providers test` after each.

### Step 3: Docs + changeset

`.docs/providers.md` gains the caching rules (stable data yes / signed data
no / TTL classes). Changeset: `perf(providers): persist stable provider metadata across sessions`.

## Test plan

- Per migration: miss → fetch → store → hit without refetch (injected fake
  port, controlled `now()` — repo tests use injected clocks; never real time).
- TTL expiry → refetch path.
- Negative: assert no stream URL or cookie string is ever passed to
  `cache.set` (grep the diff + a lint-of-convention test if cheap).

## Done criteria

- [ ] Audit table in PR description; every migrated row justified stable
- [ ] anidb external-id lookups survive process restart via the port
- [ ] No signed/short-lived value is persisted anywhere
- [ ] `bun run test --force`, `typecheck --force` green; changeset + docs land

## STOP conditions

- `ProviderCachePort`'s actual API differs from what this plan assumes (read
  the real interface first — :502).
- A provider's "stable" data turns out to be user-specific (e.g. keyed by
  session token) — drop that row from the table; correctness over coverage.

## Maintenance notes

- The port's key namespace convention matters for `/reset-provider-health`
  and cache-clear commands — check whether provider-cache rows are scoped
  there (`.docs/title-provider-health-and-cache-reset.md` owns that doc; update
  it if a new namespace must join the reset sweep).
- If a migrated cache shows stale-data reports post-release, the TTL class —
  not the port — is the dial to turn.
