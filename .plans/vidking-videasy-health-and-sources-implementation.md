# VidKing / Videasy + Sources UX + Title health — implementation plan

Status: **implemented** (2026-05-27).  
Depends on: `CINEBY_VIDKING_FIX_PLAN.md`, `.docs/flavor-naming-and-source-inventory-ux.md`, `.docs/title-provider-health-and-cache-reset.md`.

### Locked decisions

| Topic               | Choice                                                           |
| ------------------- | ---------------------------------------------------------------- |
| UI label            | **Source** / Sources panel                                       |
| Flavor names        | **Themed** (Luffy, Naruto, Bocchi, Gintoki…) + language subtitle |
| Phase A fallback    | **Up to 3** ordered English mirrors, then stop                   |
| Videasy timeout     | **90s** first attempt                                            |
| Title health        | **Advisory only** — no silent provider reorder                   |
| Provider packaging  | **vidking only** + flavor registry; cineby alias if needed       |
| Phase B lazy probe  | **English + preferred audio language** flavors                   |
| Breach / Blackbeard | **Ship without** until harvest                                   |

---

## Goal

Reliable Videasy resolve (no 15×12s timeout spiral), honest **Sources** UI with themed labels, and **advisory** title memory the user can override.

---

## Workstreams (can parallelize after P0 contract)

| ID     | Workstream                                  | Owner slice                            | Blocks             |
| ------ | ------------------------------------------- | -------------------------------------- | ------------------ |
| **W1** | Videasy resolver hardening                  | `packages/providers` + `packages/core` | Everything VidKing |
| **W2** | Flavor registry + single-source resolve API | `packages/providers`                   | W3, W4             |
| **W3** | Phase A/B resolve scheduling                | `apps/cli` playback services           | W4                 |
| **W4** | Sources shell + inventory projection        | `apps/cli` app-shell                   | W2                 |
| **W5** | Title/global health + override + reset      | `apps/cli` + `packages/storage`        | W4 UX              |
| **W6** | Harvest / Breach mapping                    | `apps/experiments` → registry          | French row only    |

---

## Phase 0 — Confirm & harvest (no prod behavior change)

**Duration:** 0.5–1 day (human + lab network)

- [ ] Run server sniff on network where `cineby.sc` / `vidking.net/embed` loads.
- [ ] Map **Breach** → endpoint; confirm Vyse vs Breach distinct.
- [ ] Record cold/warm p50/p95 per endpoint for timeout defaults.
- [ ] Lock flavor table v1 (IDs stable; labels per theme decision).

**Exit:** Flavor table signed off; timeout numbers chosen.

---

## Phase 1 — Stop the bleeding (P0 backend) — **ship first**

**Files:** `packages/providers/src/vidking/direct.ts`, `packages/core/src/provider-engine.ts`, provider cycle config.

| Task | Change                                                                                       |
| ---- | -------------------------------------------------------------------------------------------- |
| 1.1  | Videasy fetch timeout **60–90s** (per decision); engine `attemptTimeoutMs` ≥ fetch + decrypt |
| 1.2  | Default path: **one** server (`mb-flix` / Luffy) per resolve attempt                         |
| 1.3  | Remove parallel fanout of 4+4 servers on default path                                        |
| 1.4  | Timeout + deterministic Videasy 500 → **non-retryable** for same candidate                   |
| 1.5  | Cap engine retries on same provider+source (max **1** warm retry optional)                   |
| 1.6  | Acceptance: `vidking-bloodhounds.smoke.ts` ≤2 HTTP calls happy path; p95 &lt;90s             |

**Does not include:** shell picker, themed names, title health UX.

**Exit:** Live smoke green; no 160s timeout loops in logs.

---

## Phase 2 — Query parity (P1 backend)

| Task | Change                                                                     |
| ---- | -------------------------------------------------------------------------- |
| 2.1  | Query builder: `tmdbId`, season/episode, `year`, `imdbId`, `_t` when known |
| 2.2  | Optional `db.videasy.net` preflight (behind flag or always-on if &lt;5s)   |
| 2.3  | Tests: URL shape matches browser capture fixtures                          |

**Exit:** Diagnostic log shows same query keys as embed for test titles.

---

## Phase 3 — Flavor registry (P0 for UX, P1 for full roster)

**Files:** `packages/providers/src/vidking/flavors.ts` (new), migrate `cineby/index.ts` to import.

| Task | Change                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------- |
| 3.1  | `FlavorDefinition`: `id`, `endpoint`, `queryFilters`, `audioLanguage`, `mediaKinds`, `themeLabels` |
| 3.2  | `resolveVidkingDirect({ flavorId })` — exactly one endpoint per call                               |
| 3.3  | Ordered fallback list for Phase A (depth per decision)                                             |
| 3.4  | Export `listVidkingFlavors()` for shell + inventory                                                |
| 3.5  | Rivestream / AllManga / Miruro: theme label resolver hooks (stable order)                          |

**Exit:** Unit tests per flavor; no duplicate lists in cineby vs vidking.

---

## Phase 4 — Resolve scheduling Phase A / B (P0 UX backend)

**Files:** `PlaybackResolveWorkService`, `SourceInventoryService`, `PlaybackSourceInventoryProjection`.

| Task | Change                                                                         |
| ---- | ------------------------------------------------------------------------------ |
| 4.1  | **Phase A:** resolve selected/default flavor only (+ approved fallback depth)  |
| 4.2  | On stream start → signal **Phase B** lazy probes                               |
| 4.3  | Cap concurrent probes (default **2**)                                          |
| 4.4  | Inventory states: `selected`, `available`, `failed` (✕), `probing`, `disabled` |
| 4.5  | `preferFreshStream` + manual source pick bypasses stale stream cache           |

**Exit:** Play starts without waiting for full grid; inventory fills after ~5s.

---

## Phase 5 — Shell Sources UI (P0 UX)

**Files:** app-shell overlay, `PlaybackSourceInventoryView`, mockup `.design/cli/sources-overlay-mockup.html`.

| Task | Change                                                   |
| ---- | -------------------------------------------------------- |
| 5.1  | **Sources** overlay (provider → flavor → quality copy)   |
| 5.2  | Theme labels from registry (Luffy, Naruto, …)            |
| 5.3  | Switch source → handoff if probed; else targeted resolve |
| 5.4  | Status line: `VidKing · Luffy · 1080p`                   |
| 5.5  | Failed row: red ✕ + reason; **Retry** on row             |

**Exit:** User can pick Brook (DE) without provider fanout.

---

## Phase 6 — Title & provider health (P0 product trust)

**Files:** `TitleProviderHealthService`, `PlaybackResolveService`, `workflows.ts`, `PlaybackPhase.ts`.

| Task | Change                                                                           |
| ---- | -------------------------------------------------------------------------------- |
| 6.1  | `TitleProviderHealthService.clear(titleId, providerId?)`                         |
| 6.2  | Resolve input: `ignoreTitleHealthSuggestion`, optional `forceProviderOrder`      |
| 6.3  | **Default behavior per decision:** advisory-only vs reorder vs off               |
| 6.4  | Banner: “VidKing struggled… [Retry VidKing anyway] [Use Naruto]”                 |
| 6.5  | Retry clears title health for that provider + `preferFreshStream`                |
| 6.6  | `/clear-cache` option: **Also clear provider memory** (B+C tables)               |
| 6.7  | Global `down`: still skippable in fallback; **do not** block explicit user retry |
| 6.8  | Two clean successes still clears title record (keep)                             |

**Exit:** User can force VidKing after false “dead”; clear-cache resets all three layers.

---

## Phase 7 — Diagnostics & polish (P1–P2)

- Per-flavor cooldown in inventory (not global provider down from one bad endpoint).
- Support bundle: `flavorId`, `endpoint`, `failureClass`, latency.
- Warm “Retry same source” longer deadline.
- Browser-fetch port only if P0–P2 insufficient in field.

---

## Dependency graph

```text
Phase 0 (harvest)
    ↓
Phase 1 (timeouts / single-server) ──→ Phase 2 (query)
    ↓                                      ↓
Phase 3 (registry) ←────────────────────────┘
    ↓
Phase 4 (A/B scheduling)
    ↓
Phase 5 (shell)     Phase 6 (health) — can start 6.1–6.2 after Phase 1
```

**Recommendation:** Merge **Phase 1 + 6.1–6.2 + 6.6** in first PR (reliability + escape hatches). **Phase 3–5** second PR. **Phase 2** can trail if query parity not blocking smoke.

---

## Risks

| Risk                                | Mitigation                                      |
| ----------------------------------- | ----------------------------------------------- |
| 90s blocking UX                     | Phase A only one source; show progress + cancel |
| Videasy rate limit from lazy probes | Cap concurrency; cooldown per endpoint          |
| Themed names confuse users          | Subtitle always `English · primary`             |
| Breach unmapped                     | Ship v1 without Blackbeard row                  |
| Bare fetch still hangs              | P2 browser port; document VPN/egress            |

---

## Test plan (release gate)

- [ ] Unit: flavor → URL; failure classification; health clear API
- [ ] Integration: Phase A single call; Phase B inventory updates
- [ ] Live: `vidking-bloodhounds`, one anime + one movie
- [ ] Manual: title health banner + Retry anyway + extended clear-cache
- [ ] Regression: Rivestream/Miruro resolve unchanged

---

## Remaining minor confirmations (reply in chat if you disagree)

| #   | Question                        | Recommendation                                                                                             |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | Failed row glyph in terminal    | Unicode **✕** (mockup); fallback `[x]` if terminal lacks Unicode                                           |
| R2  | Extended clear-cache            | Default **unchecked** “Also clear provider memory”; show what each clears                                  |
| R3  | PR order                        | **PR1:** Phase 1 + Phase 6 (health advisory + clear API); **PR2:** Phase 3–5                               |
| R4  | Global `provider_health` `down` | Still skip in **automatic** fallback list; **never** block explicit “Retry VidKing” / manual provider pick |
| R5  | `recoveryMode: guided`          | Unchanged; title suggestion no longer reorders — only banner + buttons                                     |
