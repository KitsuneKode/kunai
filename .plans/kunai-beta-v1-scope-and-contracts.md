# Kunai — Beta v1 scope and architecture contracts

Status: Active (locked decisions for v1 public beta)  
Last updated: 2026-05-04

This document captures **product name**, **beta acceptance themes**, and **engineering contracts** so implementation stays modular (cache, history, subtitles, providers) without spilling concerns across the tree. Strategic “100M” and web-scale plans stay in their existing files but are **out of scope** for beta acceptance; see [roadmap.md](roadmap.md) to park or archive them.

---

## Locked decisions

| Decision          | Choice                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Product name      | **Kunai** (docs and UI should converge on this name over time).                                         |
| Beta focus        | CLI-first, releasable quality; moonshot / growth / relay docs do not block beta.                        |
| Long horizon docs | May move under `.archive/plans/` (or similar) so day-to-day work tracks **beta-readiness** + this file. |

---

## Beta v1 pillars (your list → engineering tracks)

Each pillar implies **one primary seam** in code (interface + owner module). Features plug into that seam; providers stay thin.

### 1 — Playback smoothness (VidKing, Rive, AllAnime, Miruro, AniKai)

- **Contract:** `Provider.resolveStream` returns a playable `StreamInfo` (or null with diagnosable failure). Player owns timing and IPC; no provider-specific logic in `mpv.ts`.
- **Acceptance:** Golden-path smoke per provider; autoplay EOF behavior verified for TMDB + anime IDs that represent real catalog shapes.

### 2 — Subtitles (first-class, honest soft vs hard, low waste)

- **Contract:** Providers emit **what they know**: `subtitle` / `subtitleList`, `subtitleSource`, `subtitleEvidence` (already in domain types). Orchestration uses `choosePlaybackSubtitle` + late attach only when prefs require it; **no** Wyzie or extra fetches when `subLang === "none"`.
- **Acceptance:** Configured language drives mpv tracks; UI does not imply tracks that were never fetched; no request storms (debounce / single-flight for optional enrichers).

### 3 — History (richer right pane)

- **Contract:** `HistoryStore` remains the persistence boundary; UI reads **denormalized display model** built from history rows + optional TMDB/catalog fetch (lazy, keyed by title id). No provider logic inside the store.
- **Acceptance:** Right pane shows poster when available, episode marker, progress, provider, and “where you are” in the series without blocking the shell on slow network.

### 4 — Autoplay / prev-next / abuse surface / resolve UX / cache feel / dub-sub / quality

- **Contract:** `PlaybackPhase` owns session transitions; **Esc** cancels active resolve (`AbortController` already wired—verify all long resolves respect signal). Prefetch + `CacheStore` back instant autonext where URLs remain valid.
- **Sub/dub:** Prefer a single **`ResolveContext`** (future) or extend `StreamRequest` so `animeLang` and quality prefs are explicit inputs to resolve + cache keys (today some prefs live on `ConfigService` only).
- **Quality:** Provider returns **candidates** where applicable; shell applies **user preferred quality** with deterministic tie-break; cache key includes quality tier when it changes the chosen URL.
- **Autonext feel:** Explicit **transition state** in shell (“Loading next episode…”) from autonext decision until `mpv` has the new URL (no silent blank gap).
- **Acceptance:** Power features that can be abused (e.g. manual subtitle reload) hidden or gated; happy path stays fast.

### 5 — (Reserved; merged into 4 above in original note)

### 6 — Fail fast, visible retries, not “infinite nothing”

- **Contract:** Every long operation reports **stage** to `diagnosticsStore` + user-visible status line where appropriate. Retries log **attempt N / reason**; bounded timeouts by default.
- **Connection “speed”:** Optional, **off by default**—small HEAD or timing probe only if product wants it; avoid per-frame overhead.

### 7 — Interactive UI, modular code, future Sentry/PostHog

- **Contract:** Ink surfaces as composable panes; business rules in services (`PlaybackPhase`, stores, providers)—**no** ad hoc cross-imports from UI into scrapers.
- **Observability hooks:** Reserve narrow `analytics.capture(event)` seam (no-op in beta) so Sentry/PostHog can land without rewiring UI.

### 8 — Config + diagnostics for support

- **Contract:** Config read/write through `ConfigService` / store only. Diagnostics overlay + structured logs remain the **first-class** support path; optional “copy last N events” or export builds trust before remote telemetry.

### 9 — JIT Playwright + provider health + optional aggregate telemetry

**Opinion (recommended for beta):**

- **Before** network telemetry: ship **opt-in** “export diagnostics bundle” (redacted URLs if needed) so users can paste one blob—highest signal, lowest backlash.
- **Telemetry v2 (post-beta or late-beta opt-in):** Cloudflare Worker ingesting **aggregates only** (provider id, operation, latency bucket, success/fail, app version, anonymous install id). **No** episode titles or watch history in the payload. Worker stores rollups (D1/KV); dashboard is internal first.
- **Unique installs:** Random UUID at first run, stored locally; user can reset. GDPR-style disclosure in README / settings.
- **Why:** You get regression detection across the fleet without turning Kunai into spyware. JIT Playwright leases still belong in the runtime package plan, not in the telemetry Worker.

### 10 — Determinism, SDK-shaped providers, packaging (npm, AUR, brew)

- **Contract:** Provider registry + manifests define behavior; tests lock golden resolves where possible. Releases require `typecheck` + agreed lint bar documented in [beta-readiness.md](../.archive/plans/beta-readiness.md).
- **Acceptance:** `kunai` binary behavior matches docs; install paths documented per target.

---

## Cross-cutting architecture (what “good” looks like)

| Piece         | Single job                        | Stable interface                                                                             | Providers touch it by                        |
| ------------- | --------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Cache**     | Persist / TTL stream-shaped blobs | `CacheStore` + **one** key builder module (to be consolidated from Playback + browser paths) | Returning `StreamInfo`; not importing SQLite |
| **History**   | Read/write watch state            | `HistoryStore`                                                                               | Never (history is post-play)                 |
| **Subtitles** | Select + attach policy            | `choosePlaybackSubtitle`, `selectSubtitle`, player attach API                                | Emitting tracks + evidence                   |
| **Resolve**   | Session + fallback + cancel       | `PlaybackPhase` + `resolveWithFallback`                                                      | Implementing `Provider` only                 |

**Lazy work:** subtitle enrichers, poster fetch, Wyzie, optional HEAD-for-liveness run **only** when user prefs or cache policy require them—not on every keystroke.

**Cache liveness vs wall-clock TTL:** Today SQLite entries expire by **time** (`DEFAULT_CACHE_TTL`). A better feel is **TTL + optional lightweight validation** (e.g. conditional GET or HEAD on manifest URL) before trusting cache—add as a **tracked hardening** item after beta stability, so we do not block v1 on perfect liveness.

---

## Doc / plan hygiene (agreed process)

1. Keep [beta-readiness.md](../.archive/plans/beta-readiness.md) as the **checklist**.
2. Keep [roadmap.md](roadmap.md) as the **index**; mark moonshot plans **Parked** with one line each.
3. Move superseded or principal-only plans to **`.archive/plans/`** (create folder when ready); leave a stub line in roadmap pointing to archive for archeology.
4. Runtime truth for agents: [architecture.md](../.docs/architecture.md); target shape: [architecture-v2.md](../.docs/architecture-v2.md).
5. Rename user-facing strings from legacy product names to **Kunai** in a dedicated pass (does not block playback work).

---

## Suggested implementation order (next rounds)

1. **Truth:** Finish open items in [beta-readiness.md](../.archive/plans/beta-readiness.md) (autoplay live verify, Playwright guardrail, lint policy, shell transition polish).
2. **Contracts:** Introduce `StreamResolveCache` (or equivalent) module—single key API used by `PlaybackPhase` and `BrowserServiceImpl`.
3. **UX:** History right pane density; autonext loading state; fail-fast/retry copy.
4. **Prefs:** Quality selector + dub/sub preference surfaced in UI + threaded into resolve/cache keys.
5. **Telemetry:** Export-first; then opt-in Worker aggregates if you still want fleet view.

---

## Related

- [kunai-execution-passes-and-cli-modes.md](kunai-execution-passes-and-cli-modes.md) — sequencing (perf vs reliability vs UX), CLI minimal/quick flags, autoskip notes
- [beta-readiness.md](../.archive/plans/beta-readiness.md) — operational checklist
- [roadmap.md](roadmap.md) — index and parked tracks
- [.docs/diagnostics-guide.md](../.docs/diagnostics-guide.md) — tracing for support
- [.plans/kunai-architecture-and-cache-hardening.md](kunai-architecture-and-cache-hardening.md) — post-beta scale (do not conflate with v1 beta gate)
