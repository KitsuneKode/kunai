# Kunai — Execution passes, CLI modes, and when we plan work

Status: Active  
Last updated: 2026-05-04

This plan sits alongside [kunai-beta-v1-scope-and-contracts.md](kunai-beta-v1-scope-and-contracts.md) (what we are building) and [beta-readiness.md](beta-readiness.md) (checklist). It answers **how we sequence work** across performance, reliability, and experience, **when** plans are refreshed, and **CLI modes** for power users.

---

## Two capacities (always in tension)

| Capacity | Means | Primary owners |
| -------- | ----- | ---------------- |
| **Performance** | Cache hits, prefetch, lazy IO, fewer round trips, JIT Playwright leases | `PlaybackPhase`, `CacheStore`, `@kunai/providers`, future runtime-browser package |
| **Reliability** | Deterministic state, timeouts, fail-fast errors, visible retries, tests | Phases, `PlayerService`, stores, `diagnosticsStore`, CI |
| **Experience** | Feedback during waits, overlays, history richness, autonext feel, discoverable config | Ink shell, `PlaybackPhase` status strings, settings |

**Rule:** No UX change without a reliability story (timeouts, cancel, diagnostics event). No perf change without a measurable target (cold resolve, autonext gap, cache hit rate in logs).

---

## Planning rhythm (when we “make the plan”)

| Cadence | Output |
| ------- | ------ |
| **Now** | This file + beta scope + roadmap row — baseline for v1 beta execution. |
| **Each milestone** (e.g. “beta blocker burn-down”, “post-beta hardening”) | Update `beta-readiness.md` checkboxes; add dated notes at bottom of this file or milestone section in `roadmap.md`. |
| **Monthly or after a large merge** | 30-minute doc triage: archive superseded `.plans/*`, fix `architecture.md` module table drift. |

**Next passes** (suggested order for the “whole change” toward your goals):

1. **Pass A — Truth** — Close `beta-readiness.md` open items (autoplay live verify, Playwright guardrail, lint policy, shell transition polish).  
2. **Pass B — Contracts** — `StreamResolveCache` (single key module), extend `StreamRequest` / resolve context for dub/quality prefs.  
3. **Pass C — UX + abuse surface** — History right pane, autonext loading state, hide/gate power actions, staged resolve copy.  
4. **Pass D — CLI modes** (this document’s flag section) — parseArgs + session flags + help text.  
5. **Pass E — Observability** — Diagnostics export; then optional opt-in telemetry (see beta scope doc).

---

## Other features worth focus (near roadmap)

Beyond your beta pillars, these pay rent on maintainability:

- **IntroDB / AniSkip merge correctness** — keep `mergeTimingMetadata` rules explicit; add tests when IntroDB adds new segment kinds.  
- **Provider health matrix** — lightweight local doc or JSON of “last known good” per provider (feeds future telemetry).  
- **Golden playback tests** — extend `playback-golden-state-verifications.md` where flakiness hurts confidence.  
- **mpv reopen / IPC** — keep on active list until closed or explicitly waived.

---

## CLI: minimal / quick / jump (flags)

**Constraint:** Reserve **`-h` / `--help`** for standard usage text. Do not overload `-h` for “history” or “home” — it confuses packagers and users.

**Recommended flag set (design before coding):**

| Flag | Working name | Behavior (proposal) |
| ---- | ------------- | --------------------- |
| `--minimal` | `-m` | Fewer Ink panels / calmer footer / skip nonessential animations (exact UX TBD in shell pass). |
| `--quick` | `-q` | Fast path: e.g. jump straight to search result pick or last provider (needs precise spec to avoid surprising autoplay). |
| `--jump <n>` | | Pick *n*th search result non-interactively (pairs with `-S`). |
| `--no-shell` / `--headless-resolve` | | Future: resolve + mpv only (advanced); not required for first slice. |

**Implementation seam:** extend `parseArgs` in `apps/cli/src/main.ts`, thread a `cliPresentation: "default" | "minimal" | "quick"` into `SessionController` / state init, and document in [.docs/quickstart.md](../.docs/quickstart.md).

**Deliverable:** one PR that adds flags + help text + no-op or minimal wiring; second PR that implements minimal layout toggles in the shell.

---

## Autoskip (intro / recap / preview / credits)

**How it works today**

- Timing comes from `PlaybackTimingAggregator` (IntroDB + AniSkip merged). AniSkip maps `op` → intro, `ed` → credits, `recap` → recap.  
- `findActivePlaybackSkip` in `playback-skip.ts` chooses an active segment from `time-pos` vs segment windows; respects `skipRecap` / `skipIntro` / `skipPreview` / `skipCredits` and `autoNextEnabled` (credits hybrid).  
- **Persistent session:** `PersistentMpvSession` calls `maybeAutoSkip` on each `time-pos` update and after ready work.  
- **One-shot `launchMpv`:** same skip helper on `time-pos`.

**Fix landed (2026-05-04):** After a resume `seek` in `PersistentMpvSession.runReadyWork`, `currentPositionSeconds` could still be `0` while autoskip ran, so recap/intro could seek **before** the user’s resume point. We now set `currentPositionSeconds` to `startAt` when the resume seek succeeds so segment detection aligns with the resume position.

**Known limitations (document, don’t silently promise)**

- Segments with **missing `endMs`** are ignored by `findActivePlaybackSkip` (needs a finite end). If IntroDB ever sends open-ended outros, add duration-clamped synthetic ends or skip only when end is known.  
- **Ordering:** recap → intro → preview → credits scan order means overlapping windows prefer the earlier kind in list order — verify against product intent if overlaps appear in real data.

**Verification:** enable skips in settings; play an anime episode with AniSkip data; confirm intro jumps once; with autoplay on, credits skip near EOF when policy says so. Use diagnostics overlay for `segment-skipped` events.

---

## Related

- [kunai-beta-v1-scope-and-contracts.md](kunai-beta-v1-scope-and-contracts.md)  
- [beta-readiness.md](beta-readiness.md)  
- [roadmap.md](roadmap.md)  
- [.docs/diagnostics-guide.md](../.docs/diagnostics-guide.md)

---

## Milestone log

- **2026-05-04** — Pass A–E ship prep batch: CLI `--minimal` / `--quick` / `--jump`, `shellChrome` + `effectiveFooterHints`, diagnostics export (`export-diagnostics`), `quitNearEnd*` settings, Playwright Chromium warning in `checkDeps`, stream resolve cache module + `StreamRequest.animeLang`, provider resolve diagnostics `stage`/`attempt`, late subtitle single-flight guard, history panel TMDB id, `PACKAGING.md` + quickstart updates. Autoplay live verify remains a manual checkbox in `beta-readiness.md`.
