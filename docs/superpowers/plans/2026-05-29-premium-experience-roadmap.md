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

**Deferred (logged):** `NewSeasonSignal`/`ReleaseNewSeason` → `@kunai/types` dedup (Plan D); movie resume/restart one-shot path (flow/live).

**Gated on a dedicated focused pass (per architecture discussion):** **1b** (consumer migration to the new decision vocabulary — no lossy bridge; needs live verify of history/calendar/discover surfaces). Then Plan S (surfaces, live), Plan F (features, live), Plan Z (live), Plan 4 (PlaybackPhase decomposition, large), Plan R (render rescope, live).

## Related

- Memory: [[project_backend_hardening_roadmap]] (backend plans 1-5), [[project_html_mockups]] (prototypes are the visual target), [[project_sakura_canonical]] (design authority), [[project_cli_redesign]] (warm/hearth direction), [[feedback_question_recommendations]].
- Triage of existing render/surface bugs: `.plans/sakura-surface-polish-and-bugs.md`.
