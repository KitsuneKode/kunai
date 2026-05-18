# Cache and MPV Runtime Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune cache and mpv runtime behavior for faster playback without stale stream regressions.

**Architecture:** Split volatile stream URLs from stable provider metadata. Keep stream TTLs short; increase retention only for stable metadata, fixtures, and release/artwork facts.

**Tech Stack:** `packages/storage`, `apps/cli/src/services/playback`, mpv launch options.

---

## Agent Tracking Header

```text
SLICE_ID: P7
SLICE_STATUS: planned
SLICE_OWNER: unassigned
SLICE_LAST_UPDATED: 2026-05-18
SLICE_CURRENT_TASK: P7-T1
SLICE_BLOCKERS: none
```

## File Ownership

Modify:

- `packages/types/src/index.ts` only if new TTL classes are needed.
- `packages/storage/src/ttl.ts`
- `packages/storage/src/cache-key.ts`
- `packages/storage/test/storage.test.ts`
- `apps/cli/src/services/playback/SourceInventoryService.ts`
- `apps/cli/test/unit/services/playback/source-inventory-service.test.ts`
- mpv runtime files only in a separate follow-up commit after cache policy tests pass.

Do not globally increase `stream-manifest` or `direct-media-url` TTLs.

## Tasks

### P7-T1: Lock Cache Identity Rules

- [ ] Add tests proving source/server/audio/hardsub/quality byte-affecting inputs change source inventory cache keys.
- [ ] Add tests proving poster/release/display labels do not change source inventory cache keys.
- [ ] Bump `SOURCE_INVENTORY_SCHEMA_VERSION` only if the key preimage changes.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `test(cache): lock source inventory identity rules`.

### P7-T2: Add Stable Metadata Cache Policy If Needed

- [ ] Add metadata TTL classes only for stable non-byte-affecting data.
- [ ] Keep `stream-manifest` and `direct-media-url` TTLs short.
- [ ] Add storage tests.
- [ ] Run `bun run --cwd packages/storage test`.
- [ ] Commit with message `feat(cache): separate stable provider metadata ttl`.

### P7-T3: Add Cache Diagnostics

- [ ] Record cache hit/stale/miss/validation timeout/invalidation reason.
- [ ] Redact key preimages in diagnostics while keeping enough parts to debug.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(diagnostics): explain source inventory cache decisions`.

### P7-T4: Evaluate MPV Cache Separately

- [ ] Document current mpv cache options before changing them.
- [ ] If changed, isolate in a commit that touches mpv launch/runtime files only.
- [ ] Add tests for option construction where possible.
- [ ] Commit with message `perf(mpv): tune playback cache profile` only if evidence supports it.

## Stop Conditions

- Stop if a cache change could replay sub when dub was requested.
- Stop if a cache change requires deleting user cache rows instead of versioning key identity.
- Stop if mpv cache tuning is based on guesses instead of observed playback behavior.

## Acceptance Tests

- Expired stream URLs are not reused as if fresh.
- Stable artwork/release metadata can survive longer than stream manifests.
- Manual refresh invalidates source inventory for the selected provider/title/episode only.
