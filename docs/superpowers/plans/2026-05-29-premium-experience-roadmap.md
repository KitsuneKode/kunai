# Kunai Premium Experience — Master Roadmap

Date: 2026-05-29
Status: living index. Umbrella for the backend + experience plans born from the
2026-05-28/29 audit + brainstorm. Each plan below gets its own spec → plan →
implementation cycle. Code is source of truth; `.md` specs can drift.

## North star

A terminal-first anime/media app that feels **Netflix-cohesive, Crunchyroll-rich,
YouTube-sticky, and Claude-Code-polished** — instant, keyboard-first, flicker-free,
resize-proof — good enough to **poach ani-cli users** (match their bare speed via
Zen mode) while giving them a reason to stay (continue/history, calendar, stats,
recommendations, downloads, presence). The design language already exists (Sakura:
rose=focus/in-progress, mint=ready/done, "color encodes state not identity",
semantic tokens in `packages/design`). The gap is **cohesion, completeness, and
render robustness**, not language.

## Locked decisions (this session)

1. **Continuation = Netflix anchor** (most-recent episode; resume-if-unfinished-else-advance; per-episode truth stored). Plan 1.
2. **Single source of truth for history** — retire the `HistoryStore` facade; `HistoryProgress` only. Plan 1.
3. **`completed` flag is finished-authority** (95% ratio only a `duration>0` fallback). Plan 1.
4. **Renderer: harden Ink, do NOT migrate to OpenTUI now.** OpenTUI (Zig core + React reconciler, shadow-buffer no-flicker) is promising but self-labeled not-production-ready with an unstable API; the "messy" feeling is our architecture (god-files, scattered flow), not Ink. Route all UI through `app-shell/primitives` so OpenTUI stays a clean future swap. Plan R.
5. **Navigation IA = Claude-Code tabs/sub-tabs + persistent footer-hint row** as the canonical shell spine (primitives `TabStrip`/`ClaudeTabRow`/`SegmentedControl` already exist). Plan S.
6. **Zen mode = live toggle + config default**, full-feature-reachable, single-column minimal chrome. Plan Z.
7. **Flow coherence is its own plan** (Plan C) — no permutation may dead-end or mis-default.
8. **Feature priorities (all selected):** Up Next + autoplay chain; in-playback sub/dub + quality + subtitle quick-switch; watch heatmap + streaks + stats; smart resume-everywhere + recommendations. Plus trending/calendar completion and queue/playlist visibility. Plan F.

## Plans & sequencing

Backend (data correctness) and Experience (the feel) tracks run partly in parallel.

| Plan  | Title                                                         | Depends on   | Status                                |
| ----- | ------------------------------------------------------------- | ------------ | ------------------------------------- |
| **1** | History + Continuation read model                             | —            | spec ✅, phase 1a plan ✅, 1b pending |
| **2** | Release/airing correctness (`.docs/audit-airing-episodes.md`) | 1 (contract) | audit ✅, spec pending                |
| **3** | Unified playable identity + Up Next                           | 1            | pending                               |
| **4** | `PlaybackPhase` decomposition                                 | —            | pending                               |
| **R** | Render runtime hardening (foundation)                         | —            | pending — **do early**                |
| **C** | Flow coherence / no dead-ends                                 | 1, 3         | pending — **live pain**               |
| **S** | Surface parity to `.prototypes/` HTML                         | R            | pending                               |
| **F** | Feature catalog (Netflix/CR/YT)                               | 3, S         | pending                               |
| **Z** | Zen mode                                                      | S            | pending                               |
| **D** | Codebase cleanup & dedup sweep                                | 1,3,4,C      | pending                               |

**Recommended order:** R (foundation) + Plan 2 (pure backend, parallel) →
C (fixes live correctness, unblocks correct play entry) → 3 → S → F → Z. Plans 1b
and 4 slot in as capacity allows.

## Plan R — Render runtime hardening (foundation)

The renderer everything sits on. Verified gap: Ink mounts a full-height box
(`ink-shell.tsx:903`) with **no alternate-screen buffer** (no `\x1b[?1049h/l`), so
quit pollutes scrollback and full-height + resize causes the flicker/creep class
already logged in `.plans/sakura-surface-polish-and-bugs.md` (A6 ghost poster, A7
loader desync, B8 "dancing" lists).

Scope: enter/exit alt-screen cleanly (restore scrollback + cursor on quit and on
crash); adopt Ink incremental rendering; reserved-height layout discipline (no
dancing); responsive `layout-policy` breakpoints audited against narrow/medium/wide;
graceful teardown on SIGINT/SIGTERM/SIGWINCH; fix A6/A7/B8. Isolate all of this
behind `app-shell/primitives` + a render-runtime module so the renderer is swappable.

## Plan C — Flow coherence / no dead-ends

Map every `entry → resolve → play → post-play` permutation across
`movie | series | anime` × `resume | next | first-watch | queue | recommendation |
trending | offline` and guarantee no dead-ends, no wrong defaults, one consistent
"play this" entry point.

Flagship bugs (verified from live screenshots):

- **Movie misclassified as series.** "Transformers: Revenge of the Fallen" renders
  `series · S01E01` with autoplay on and no continue. A movie is getting
  `type/mediaKind = series` + synthetic `S01E01` somewhere in the search/provider/
  session path. Fix at intake (correct `mediaKind`), and make playback/continue/
  autoplay branch on it (no S/E label, no autoplay chain, resume keys on the single
  title row — see Plan 1 movie edge case).
- **No easy "play next recommended item."** Playing a recommendation / queue entry /
  trending item each takes a different path. Needs ONE `play(PlayableRef)` entry
  (Plan 3) reachable from every surface.
- **Queue/playlist invisibility.** What's queued and what's "next" isn't surfaced;
  unify with the autoplay chain (Plan 3 Up Next).

Build the flow as a tested pure state machine, then wire + live-verify (input/flow
= high regression risk).

## Plan S — Surface parity to prototypes

Bring history/continue, calendar, stats, discover, library, post-play,
episode-picker, command-palette up to the `.prototypes/` HTML authority (build from
HTML, not the drifted `.md`; `bun run prototype:serve`). Lands the Claude-Code feel:
tab/sub-tab nav, contribution heatmap, sparkline/line charts, persistent footer
hints, weight-not-hue hierarchy, glyphs. Reuse existing primitives.

Quick design wins to fold in first: persistent footer hint row everywhere; one
canonical row component (weight title, muted meta, right-aligned state badge);
Continue card as launch hero; reserved-height everything; real Stats heatmap +
streaks.

**Keybinding coverage + discoverability (regression to fix).** Recently-removed
hotkeys left gaps. Build a single keybinding registry (one source of truth) that is:
feature-rich (every action reachable), consistent (same key = same intent across
surfaces), recognizable (mnemonic — `n` next, `r` resume/refresh by context, `/`
search, `?` help), and discoverable (per-surface footer hints + a `?` help overlay
listing all bindings). Audit what was removed and restore/redesign. Mirrors Claude
Code's always-visible hint row + consistent chord vocabulary. The footer-hint row
reads from this registry so hints can never drift from real bindings.

## Plan F — Feature catalog (steal from Netflix/CR/YT)

- **Up Next + autoplay chain** (Netflix): one clear next, cancelable countdown,
  cross-title queue. (Plan 3 feeds it.)
- **In-playback quick-switch** (Crunchyroll): audio sub/dub, quality, subtitle track
  mid-playback without restarting. Big ani-cli differentiator.
- **Watch heatmap + streaks + stats** (YouTube/Claude): sticky identity surface.
- **Smart resume-everywhere + recommendations**: resume any title from any surface;
  post-play + discover rails; easy play-the-rec.
- **Trending + calendar** completion; **queue/playlist** visibility.

## Plan Z — Zen mode

Live toggle (hotkey) + config default. Single column, no rail/chrome, minimal hints,
all features still key-reachable. ani-cli's bare speed without forking the codebase.

## Plan D — Codebase cleanup & dedup sweep

Make the implementation cleaner overall. **Much of the redundancy is already targeted
by the foundational plans** — don't duplicate it here:

- two history layers + two reconciliation engines → **Plan 1**
- duplicate projection writers (calendar vs reconciliation) → **Plan 2**
- three "next"/playable models (queue / playlist / episode-chain) → **Plan 3**
- god-file `PlaybackPhase.ts` (3965 lines) → **Plan 4**
- scattered pickers (subtitle/quality/provider) → **Plan C** pillar 5
- raw escape writes / render control → **Plan R**

Plan D owns the **remaining** cross-cutting cleanup once those land: the god-file
`app-shell/workflows.ts`, dead code (e.g. unwired JSON `HistoryStoreImpl`), the
deprecated Sakura color-token aliases (migrate call sites + delete aliases, per
`.plans/sakura-rollout.md`), duplicated helper logic, and a pass to enforce the
`feedback_code_principles` (DRY, SoC, single source of truth). Sequenced **last** so
it cleans up after the structural plans rather than fighting them. Run with
`/code-review` + `/simplify` on each touched area; behavior-preserving, test-guarded.

## Implemented so far (2026-05-29 session, all committed + green: 1333 tests)

**Landed & verified (static + review subagent):**

- **Plan 1a** — continuation core: `isFinished` authority, `projectContinuation` (Netflix anchor), `ContinueWatchingService` (dormant until 1b wires consumers).
- **Plan C1/C2** — `PlayableRef`+`buildPlayIntent`; movie display fix (content kind from `title.type`, no `S01E01`, `movieLanguageProfile`, continue/restart). Deep-intake `play(ref)` + resume/restart-choice for movies = pending (flow/live).
- **Plan 2 — backend correctness COMPLETE & reviewed:** numbering-axis guard, date-only "today"⇒upcoming (calendar + TMDB summary), **AniList SEQUEL cross-cour** + **TMDB later-season** ⇒ `newSeason`, persisted through projection→`release_progress_cache` (migration 009), calendar/reconciliation writer-race fixed. Remaining Plan 2: consumer/UI surfacing of `newSeason` (1b/S), filler classification, wire-or-remove `new-playable-episode`.
- **Plan 3** — `resolveUpNext` (pure unifier; dormant until wired).
- **Architecture/cleanup** — content-kind → `domain/media` (deduped); dead `summarizeJson`/`UpNextSource` removed.

**Deferred (logged):** `NewSeasonSignal`/`ReleaseNewSeason` → `@kunai/types` dedup (Plan D).

**Gated on a dedicated focused pass (per architecture discussion):** **1b** (consumer migration to the new decision vocabulary — no lossy bridge; needs live verify of history/calendar/discover surfaces). Then Plan S (surfaces, live), Plan F (features, live), Plan Z (live), Plan 4 (PlaybackPhase decomposition, large), Plan R (render rescope, live).

## Update (2026-05-31 session — 3 commits, all green: 1338 tests)

Two **user-reported behavior bugs** fixed at the source, TDD, unit-netted (live verify deferred to END-OF-RUN-VERIFICATION.md):

- **Anchor-rule fix (1b behavior keystone):** both live engines (`reconcileContinueHistory`, `projectContinuationState`) did `.find(unfinished)` over recency-sorted rows → resumed an OLDER abandoned episode when the most-recent was finished (opposite of Netflix). Both now anchor on the most-recent row. Regression guards added in both suites. **Key consequence:** the legacy engines now behave **identically** to the already-tested `projectContinuation`, so the remaining 1b retirement (facade + `HistoryEntry`, 27 files) is downgraded from a behavior change to a **pure behavior-preserving mechanical swap**.
- **Movie Resume/Restart fix (the thrice-reported bug):** real root cause was upstream of the earlier hypothesis — `PlaybackPhase.execute` gated the whole starting-point decision behind `title.type === "series"`; movies fell through to `episode {1,1}` + `startFromBeginning()` (always 0, no menu). Added `chooseMovieStartingPoint` mirroring the series flow via the same `openListShell` primitive; pure `resolveMovieStartingChoice` unit-tested.
- **Cleanup:** removed dead JSON `HistoryStoreImpl` (zero refs).

Remaining mechanical 1b (de-risked): retire `HistoryStore`/`SqliteHistoryStoreImpl` facade + `HistoryEntry` type → `ContinueWatchingService` + `HistoryProgress`. No behavior delta now; typecheck + tests are the net; live verify is confirmation only.

### 1b retirement — ✅ DONE (2026-06-01)

The `HistoryEntry` facade type is retired. `HistoryStore`/`SqliteHistoryStoreImpl`
return canonical `HistoryProgress` rows directly (thin read-only passthrough:
get/getAll/listRecent/listByTitle/delete/clear; `isFinished`/`formatTimestamp`
re-export from the `history-progress` authority). `save()` is gone from the facade
— both writers (`PlaybackPhase` post-playback, `workflows` "mark as watched") go
through `historyRepository.upsertProgress`, with a new `historyProgressToInput()`
helper in `@kunai/storage` for round-tripping a held row.
`enqueueReleaseReconciliation` now takes `HistoryProgress[]` (titleId on the row);
its callers pass repo rows. Both engines kept their tuple input + decision shapes
(retyped + field-fixed only). Every consumer migrated **by hand** (no bulk sed
across mixed files), preserving the `historyContentType` anime→"series" flatten
and the optional season/episode defaults. Behavior-preserving: **typecheck 8/8,
1341 tests pass with zero capture diffs, build clean** (commit on
`design/sakura-canonical`). One stale `as never` test mock (post-playback
recommendations) that still used facade field names — invisible to typecheck —
was caught by the test run and ported.

**Live verification still outstanding** (see END-OF-RUN-VERIFICATION.md): exercise
the history / calendar / discover surfaces against a real DB to confirm the
field-map migration reads correctly end to end — continue-watching rows, "N new"
badges, recency grouping, discover "Because you watched", and the mark-as-watched
write path.

### 1b retirement — historical notes (in-progress through 2026-05-31)

**Landed (green, 2026-05-31 — every independently-shippable component peeled off):**

- `playback-resume-from-history.ts` → `HistoryRepository` (sync, leaf pattern proven).
- **`historyContentType(progress)`** added in `continuation/history-progress.ts` — single authority for the anime→"series" flatten.
- **`OfflineRunwayService`** + `highestEpisode` → `historyRepository` (deps + container + test).
- **`OfflineLibraryService`** write path → `historyRepository.upsertProgress` (deps + container + test).
- **Episode picker component** (`playback-episode-picker` + feeders `tmdb-season-episode-pickers`, `ink-shell` active picker, `PlaybackPhase` watchedEntries) → `HistoryProgress` per-episode dots (test fixtures ported).

**Offline/download cluster: DONE (2026-05-31).** `OfflineRunwayService`, `OfflineLibraryService` (write→`upsertProgress`), `offline-sync-policy` + `download-cleanup-policy` + `main` auto-cleanup, `offline-history-progress` + `workflows` offline shelf — all on `HistoryProgress` (tests ported). `workflows` uses an aliased `isProgressFinished` for the offline block; the rest of that big file stays on the facade.

**Status (2026-05-31, later):** A second core-flip attempt (manual edits) got the foundation + import swaps done but was reverted again at ~115 remaining field edits when the user hit a live crash from the half-migrated tree — **the facade flip needs a dedicated full-budget session, not session tail-ends.** WIP is in `git stash@{0}` ("1b-facade-flip-WIP-2") as reference only (contains the earlier bad-sed spots; prefer redoing from this plan). Landed instead on the green base: **PreviewRail crash guard** (`visiblePreviewFacts` tolerates missing label/value) and **"Mark as watched"** history action (`markEntryWatched` + `/history` sub-menu; flags the anchor episode completed without playing). Both green/committed.

**⚠️ Core-flip lesson (2026-05-31):** attempted the entangled-core retirement by flipping the `HistoryStore` facade to return `HistoryProgress` (delete `HistoryEntry`) and letting typecheck drive field fixes. The engines/facade/enqueue/media-item/launch-entry parts went clean, but **bulk `sed` of `.provider`→`.providerId` / `.type` / `.duration` over-matched non-history objects in the MIXED view files** (`panel-data` `state.provider`/`config.provider`, `PlaybackPhase`/`workflows`/`SearchPhase`/`session-flow`/`command-router` `result.type`/`PlaybackResult.duration`) — typecheck caught most, but silent wrong-renames (objects with both fields) can't be ruled out. **Reverted to keep green.** Redo as **manual per-file edits** (NOT bulk sed): pure history-view files (`history-view`, `library-shell`, `calendar-results`, `discover-sections`, `browse-option-mappers`) are sed-safe; mixed files must be hand-edited. The field map + `historyContentType` (for `.type`) are ready; `isFinished`/`formatTimestamp` are re-exported by the facade so only `HistoryEntry` type-imports + field reads need touching. Behavior-preserving ⇒ captures should stay green (= verification without live).

**Remaining = the irreducibly-coupled core (do as ONE coordinated cluster — `HistoryEntry` threads through the big files' boundaries, so leaves can't be peeled further):**

- **`enqueueReleaseReconciliation` hub + its 5 callers** (`PlaybackPhase` save path, `SearchPhase`, `root-overlay-shell`, `workflows`) — migrate together to `HistoryProgress[]` (drop the `[id,entry]` tuple; `titleId` is on the row).
- **Two engines + projection consumers**: merge `reconcileContinueHistory`+`projectContinuationState`→`projectContinuation`/`ContinueWatchingService`; migrate `history-view`(×4), `panel-data`(×2), `root-history-bridge`(×2), `ResultEnrichmentService`, `main:299`, `root-overlay-shell:282`; `badgesFor(decision)` adapter; delete `ContinuationProjectionService`; **re-bless `__captures__/history-continue.*`**.
- **Raw-row readers**: `runtime-bindings`, `workflows` (history-mgmt UI), `calendar-results`, `discover-sections`, `SearchPhase`, `main` (continue selection via `launch-entry`), `browse-option-mappers`, `media-item-adapters`, `DownloadOnlyPhase`, `session-flow`.
- **Offline policy leaves** (fed by raw readers): `offline-history-progress`, `offline-sync-policy` (use `historyContentType`), `download-cleanup-policy`.
- **PlaybackPhase get×2** (`getLatestForTitle`, feeds session-flow's HistoryEntry funcs — migrate with session-flow).
- **Delete facade**: `HistoryStore.ts`, `SqliteHistoryStoreImpl.ts`, `history-reconciliation.ts`, `continuation-policy.ts`, `ContinuationProjectionService.ts`, `container.historyStore`, the `HistoryEntry` type. Final typecheck+test+build+capture review.

**⚠️ Key gotcha (typecheck will NOT catch):** the facade's `toHistoryEntry` flattened `mediaKind` anime→`"series"` in `HistoryEntry.type`. Consumers branch on `.type` (e.g. `offline-sync-policy.ts:28` `entry.type !== historyKind`; badges; episode labels). A naïve `.type`→`.mediaKind` swap makes anime rows stop matching `"series"` → silent anime breakage. **Every `.type` read must become `historyContentType(row)`**, not `row.mediaKind`.

**Field map (HistoryEntry → HistoryProgress):** `timestamp`→`positionSeconds`, `duration`(0-default)→`durationSeconds`(`?? 0`), `provider`("unknown"-default)→`providerId`(`?? "unknown"` where a string is required), `watchedAt`→`updatedAt`, `type`→`historyContentType(row)`, `season`/`episode` become optional (`?? 1` / `?? absoluteEpisode ?? 1`). `mediaKind`/`externalIds`/`title` unchanged. The repo is **sync** (facade was async) — drop `await` or keep it (await on a non-Promise is harmless) to minimize caller churn.

**Facade method → repo:** `get(id)`→`getLatestForTitle(id)` (undefined not null); `getAll()`→`groupLatestByTitle(listRecent(500))` keyed by `titleId`; `listRecent(n)`→`listRecent(n)` (returns rows, map to `[titleId,row]` where tuples are expected); `listByTitle(id)`→`listByTitle(id)`; `save(id,e)`→`upsertProgress({title:{id,kind,title,externalIds}, episode:{season,episode,absoluteEpisode}, positionSeconds, durationSeconds, completed, providerId, updatedAt})`; `delete`→`deleteTitle`; `clear`→`clear`.

**Connected components to migrate (each = one green commit; facade stays until last):**

1. **Offline/download** (separable): `offline-history-progress.ts`, `offline-sync-policy.ts` (uses `historyContentType`), `download-cleanup-policy.ts`, `OfflineRunwayService.ts` + `OfflineLibraryService.ts` (deps `historyStore`→`historyRepository`; `.save`→`upsertProgress`), `enqueue-release-reconciliation.ts`. Update container wiring + these services' fake-dep tests.
2. **Continuation engines + projection consumers**: merge `reconcileContinueHistory` + `projectContinuationState` into `projectContinuation`/`ContinueWatchingService` (behavior already identical post anchor-fix); migrate `history-view.ts`(×4), `panel-data.ts`(×2), `root-history-bridge.ts`(×2), `ResultEnrichmentService.ts`, `main.ts:299`, `root-overlay-shell.tsx:282`; add a `badgesFor(decision)` adapter; delete `ContinuationProjectionService`. **Re-bless** `test/__captures__/history-continue.*` intentionally.
3. **Raw-row readers**: `runtime-bindings.ts`, `workflows.ts` (history mgmt UI — getAll/get/save/delete/clear/listByTitle), `calendar-results.ts`, `discover-sections.ts`, `SearchPhase.ts`, `main.ts` (continue selection via `launch-entry.ts selectContinueHistoryEntry*`), `browse-option-mappers.ts`, `media-item-adapters.ts`.
4. **Episode picker**: `playback-episode-picker.ts`, `tmdb-season-episode-pickers.ts`, `ink-shell.tsx:220`.
5. **Write path + delete facade**: `PlaybackPhase.ts:1868` (save→upsertProgress), then delete `HistoryStore.ts`, `SqliteHistoryStoreImpl.ts`, `history-reconciliation.ts`, `continuation-policy.ts`, `ContinuationProjectionService.ts`, `container.historyStore`. Final: typecheck + test + build + capture review.

Then the dormant `newSeason`/`PlayableRef`/`resolveUpNext` foundations have live consumers and the END-OF-RUN live checks apply.

## Plan 4 — PlaybackPhase decomposition: established pattern (continue mechanically)

`apps/cli/src/app/PlaybackPhase.ts` (~3900 lines). **Safe extraction pattern (proven, 1334 tests green):** move cohesive **module-level** helper clusters (NOT closures inside `execute()`) into focused `playback-*.ts` siblings; if a test imports a moved symbol from `PlaybackPhase`, re-export it (`export { x }`). Verify with `bun run typecheck` + full `bun run test` after each move (complete net for these moves).

- ✅ Done: `playback-startup-format.ts` (startup-stage + stream-route formatters).
- Candidate next cuts (module-level, decreasing safety):
  1. **Post-play recommendation cluster** — `openPostPlaybackRecommendationActionPanel`, `openRecommendationDetailsPanel`, `confirmAndDownloadPostPlaybackRecommendation`, `recommendationRailItemToSearchResult`, `RecommendationRailPanelAction`, + `enqueuePostPlaybackRecommendation` (move together to avoid a circular import; ~250 lines).
  2. **Post-play surface helpers** — `applyMpvEpisodeLoadingOverlay`, `preparePostPlaybackSurface`, `teardownPlaybackForPostPlayExit`, `describeSubtitleStatus`.
- **Do NOT** decompose `execute()` itself (the ~2500-line method) by mechanical move — its inner logic closes over locals; that requires real seam design + **live playback verification** and is its own focused effort.

## Update (2026-06-01 — code-vs-plan reconciliation before S/F/Z/R pass)

Grounded the experience plans against the **current** code (1b landed; HEAD
`cb61c883`, tree green, 1341 tests). Three plan premises are **stale — code moved
past them**, which retargets the remaining work:

- **Plan R alt-screen item is largely DONE, not pending.** `ink-shell.tsx:271` and
  `:1166` already mount with `alternateScreen: true`; the "no `\x1b[?1049h/l`, quit
  pollutes scrollback" premise (plan line ~52) is obsolete. Remaining Plan R is the
  narrower live set (A6 ghost poster / A7 loader desync / B8 dancing lists +
  crash-restore teardown), all **live-gated** — not a renderer rebuild.
- **esc-to-back stack already exists.** `state.activeModals` is a stack;
  `getTopOverlay` reads `.at(-1)`; `resolveEscTransition` (`root-shell-state.ts:105`)
  already closes command bar → else pops `CLOSE_TOP_OVERLAY`. The "web-routing back"
  spine is present at the overlay layer. The real gap is **surfaces that bypass the
  stack** (mounted `openListShell` screens with their own esc) + consistency, NOT a
  missing navigation model. Audit which surfaces don't route esc through
  `resolveEscTransition` and fold them in — do not build a parallel router.
- **Real Plan S foundation gap: no keybinding registry exists.** Keys, footer hints,
  and `?` help are scattered; `commands.ts` `SHELL_COMMAND_DEFINITIONS` is only the
  command-palette source. This is the single-source-of-truth to build first.

**De-risked next slices (each one green commit; unit tests are the net, live is
confirmation, deferred to END-OF-RUN-VERIFICATION.md per user):**

1. **Keybinding registry** (`app-shell/keybindings.ts`, new, pure + TDD): declarative
   bindings (chord + intent label + scope + footer priority), matcher compatible with
   `LineEditorKey`, derivations `footerHints(scope)` + `helpSections()`. Then wire the
   footer-hint row + `?` help overlay to read from it (live-confirm at end). Subsumes
   scattered definitions — replace, don't parallel.
2. **Plan 4 safe cuts** (behavior-preserving; typecheck+test net): extract
   module-level clusters from `PlaybackPhase.ts` per the proven pattern — post-play
   recommendation cluster + post-play surface helpers. **NOT** `execute()` internals
   (closes over locals; needs real seam design + live playback verify).
3. **Zen mode core** (Plan Z): config field + pure `layout-policy` single-column
   branch; live toggle wiring + verify deferred to end.

User directive for this pass: defer ALL UI live validation to the end (user drives
esc-routing / state-spill / premium-feel review); use `/frontend-design` +
`/emil-design-eng` + `/make-interfaces-feel-better` for the feel work.

## Related

- Memory: [[project_backend_hardening_roadmap]] (backend plans 1-5), [[project_html_mockups]] (prototypes are the visual target), [[project_sakura_canonical]] (design authority), [[project_cli_redesign]] (warm/hearth direction), [[feedback_question_recommendations]].
- Triage of existing render/surface bugs: `.plans/sakura-surface-polish-and-bugs.md`.
