# Resolve & Autoplay Performance — Diagnosis + Fix Plan

Date: 2026-06-06
Status: In progress — the highest-value fix (prefetch normalization) is SHIPPED on `perf/resolve-and-autoplay`; the rest need live timing (ani-cli vs us) before changing.

## Symptoms (user-reported)

- Resolution feels slow; the AllManga route "used to be so fast," now takes much longer.
- A long pause before the next episode in autoplay.
- ani-cli is also slow.
- The new AllManga route exposes metadata (AniList/MAL/popularity) we should use.

## Diagnosis

### 1. Next-episode pause — ROOT CAUSE FOUND + FIXED ✅

`matchesEpisodePrefetchTarget` (`apps/cli/src/app/episode-prefetch.ts`) compared `startupPriority` with `===`. The prefetch is scheduled with `config.startupPriority` (`"balanced"`) but a consume/advance request can carry `undefined` (the default is applied later). `undefined !== "balanced"` → **every prefetch was rejected → cold re-resolve on each advance → the pause.** This affected ALL providers' next-episode advance, including AllManga.
**Fix (shipped):** normalize both sides `(x ?? "balanced")` before comparing. Unit-tested.

### 2. AllManga resolve slowness — mostly UPSTREAM

- The default `startupPriority` is **"balanced"** everywhere, and `collectAllMangaLinksForStartup` (`allmanga/direct.ts:62`) returns the **baseline source immediately** on balanced/fast. The 4s `ALLMANGA_QUALITY_FIRST_WAIT_BUDGET_MS` wait only applies to **"quality-first"**.
- **ani-cli being slow too** is the decisive signal: it hits the same `api.allanime.day`. So the dominant cause is the **AllAnime API being degraded** right now — not our code. Much of the per-episode slowness was also the prefetch miss (#1), now fixed.

### 3. Main-thread blocking — already mostly deferred

Inter-episode heavy work is already backgrounded: `enqueueReleaseReconciliation`, recommendation warm (`backgroundWorkScheduler.enqueue`), `runBackgroundTask`. Not the pause source.

## Remaining work (needs live measurement first)

1. **Measure upstream vs code.** Time `~/Projects/osc/ani-cli` vs Kunai on the same title (CLAUDE.md names this the canonical checkout). If ani-cli is slow on the same query → upstream; the right response is resilience (below), not "make our code faster."
2. **Resolve-identity audit.** `startupPriority` is threaded into the resolve cache key / work ledger (`PlaybackResolveService`, `ResolveWorkLedger`, cache-invalidation). Verify prefetch and play resolve under _identical_ identity so the resolve cache also hits (the prefetch-bundle fix #1 is separate from the SQLite resolve cache). Apply the same `?? "balanced"` normalization at any other key-construction site that can see `undefined`.
3. **Non-blocking quality-first.** In `collectAllMangaLinksForStartup`, even on quality-first, return the baseline immediately and attach Ak only if it lands within a much smaller budget (~1–1.5s, not 4s), or stream it in as a quality upgrade — so the user never waits 4s.
4. **Resolve timeout + fast fallback.** Bound the AllAnime baseline fetch with a timeout so a degraded upstream can't hang the path; fall back to another provider past the budget.
5. **Use the metadata (no extra latency — it's in the same search GraphQL query).** Rank AllManga search results by `popularity`; feed `aniListId`/`malId` into the content classifier (strengthens #1 anime/series classification) and artwork.

## Done this branch

- `bc1ceecb` — prefetch `startupPriority` normalization (the next-episode pause fix).
