# Stream cache audit — there is no dual-cache duplication

**Date:** 2026-05-28
**Verdict:** No consolidation needed. The two caches are distinct, intentional layers.

## What was suspected

A surface read suggested two redundant stream caches with divergent keys/TTLs:

- `SqliteCacheStoreImpl` keys via `sha256(url)` with a flat TTL.
- `stream-resolve-cache.ts` builds an elaborate manifest-driven key.

The worry was that the manifest key was "bypassed" and that `sha256(url)` keyed on
the raw media URL, causing stale hits across audio/quality/subtitle preference
changes.

## What the code actually does

The suspicion is wrong. Traced through `PlaybackResolveService`:

- `buildCacheKey()` (`PlaybackResolveService.ts:736`) returns
  `buildApiStreamResolveCacheKey({...})` — the manifest-driven key including
  provider / media kind / title / season / episode / audio / subtitle / quality /
  startup / source / stream.
- Both the read (`cacheStore.get(cacheKey)`, line 208) and the write
  (`cacheStore.set(persistKey, stream)`, line 676) use that same manifest key.
- `SqliteCacheStoreImpl` is a generic key→`StreamInfo` store; the `sha256` only
  hashes the (already provider-aware) key into a stable storage row id. The
  parameter was misleadingly named `url` — now `key` — which is what caused the
  misread.
- Cache hits are additionally **health-validated** (`checkCachedStreamHealth`)
  before reuse, and invalidated on blocked/deferred/unhealthy streams.
- TTL is tied to the shared policy: `DEFAULT_CACHE_TTL = getDefaultTtlMs("stream-manifest")`.

## The two layers are intentional

| Layer                                | Question it answers                                      | Where                                                                |
| ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| Source-inventory cache               | _Which sources/qualities exist for this title?_          | `SourceInventoryService` + `@kunai/storage` `ttl.ts` (per-class TTL) |
| Resolved-stream cache (`CacheStore`) | _What is the playable URL for this chosen source+prefs?_ | `SqliteCacheStoreImpl`, manifest-keyed                               |

These are different cache levels, not duplicates. Merging them would conflate
"what exists" with "what resolved" and lose the per-resolution preference keying.

## Action taken

- Renamed the misleading `url` parameter to `key` across the `CacheStore`
  interface and `SqliteCacheStoreImpl`, with a doc comment on the interface
  explaining the key is the opaque manifest resolve key and that the two cache
  layers are intentionally separate. This prevents the same misread recurring.

No behavioral change. No consolidation.
