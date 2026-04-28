# KitsuneSnipe — Persistent Shell Implementation Plan

Status: In Progress

Use this file for the engineering sequence that turns the agreed product direction into code without creating another generation of architectural drift.

This plan is intentionally implementation-oriented. Product intent lives in:

- [.docs/product-prd.md](../.docs/product-prd.md)
- [.docs/ux-architecture.md](../.docs/ux-architecture.md)
- [.docs/architecture-v2.md](../.docs/architecture-v2.md)

## Objective

Move KitsuneSnipe from nested prompt flow toward one persistent shell with:

- one canonical runtime entrypoint
- one app-state model
- one command router
- one overlay system
- clean service seams for metadata, provider resolution, diagnostics, setup, and preview

## Guiding Rules

- do not evolve `index.ts` and `src/main.ts` as parallel full runtimes
- extract test seams before doing broad UI rewrites where practical
- preserve current reliability guarantees during migration
- prefer additive seams and shims over big-bang replacement
- every phase should leave behind tests or docs strong enough to support the next phase
- the shell must behave like a fullscreen TUI, not a stack of independent framed cards
- normal interaction must fit inside the current viewport; if it cannot, show a resize blocker instead of relying on terminal scrollback
- content hierarchy should stay stable across browse, picker, overlay, playback, and post-playback states

## Phase 0: Canonical Doc And Runtime Routing

Goal:

- make the architecture read order unambiguous
- make `src/main.ts` the declared target runtime
- stop future work from landing in the wrong layer

Tasks:

- keep [.docs/architecture.md](../.docs/architecture.md) as canonical current-runtime entry doc
- keep [.docs/architecture-v2.md](../.docs/architecture-v2.md) as target-runtime doc
- route `AGENTS.md` to the right doc set
- document `index.ts` as legacy runtime path and `src/main.ts` as target path

Exit criteria:

- future contributors can tell where current truth vs target truth lives in under a minute

Status:

- done for docs and routing
- default executable ownership now points at `src/main.ts`
- `index.ts` is now a thin compatibility wrapper into `src/main.ts`
- remaining work is runtime cleanup around helper-shell flows, not ownership ambiguity

## Phase 1: Runtime Consolidation Seams

Goal:

- make it possible to migrate behavior into `src/main.ts` without duplicating orchestration logic

Tasks:

- reduce shared runtime concerns into explicit services or modules:
  - app state
  - command registry
  - command router
  - capability service
  - diagnostics store
  - provider resolution service
  - catalog or metadata store
- extract pure state and policy logic from UI-first code where possible
- start reducing `index.ts` toward a compatibility wrapper or legacy bridge

Testing:

- reducer and state transition tests
- command availability tests
- cache and policy tests

Exit criteria:

- key state and command behavior are no longer trapped inside top-level prompt loops

Status:

- mostly done
- shared session state, command registry, subtitle policy helper, browser-cache integration, and shared provider definitions exist in the new runtime
- `src/main.ts`, package scripts, and the bin shim now point at the refactored runtime
- `index.ts` has been reduced to a compatibility bridge instead of a second orchestration path
- still incomplete where helper-shell flows and picker semantics remain mounted through transitional adapters

## Phase 2: Persistent Shell Foundation

Goal:

- mount one shell and keep it mounted across browse, select, and post-playback flows

Tasks:

- build `AppShell`
- add header, footer, status strip, content region, command bar, and overlay host
- implement the global command router in the live shell path
- add layout state for companion pane and responsive collapse rules
- wire diagnostics split between compact status and deeper overlay

Testing:

- shell state tests
- overlay open and close tests
- command routing tests
- responsive collapse policy tests

Exit criteria:

- key actions are reachable from anywhere inside the mounted shell

## Phase 3: High-Friction Flow Migration

Goal:

- move the most painful prompt-driven flows into the shell first

Migration priority:

1. search and result selection
2. provider picker
3. settings
4. season picker
5. episode picker
6. subtitle picker
7. setup blocker and setup overlay
8. history and diagnostics
9. post-playback action panel

Current checkpoint:

- shared app state, command registry, and responsive layout policy exist
- home and playback shells already resolve shared command availability
- search input and result selection now use one mounted browse shell path instead of separate prompt/shell hops
- shared shell actions now handle settings, provider, history, diagnostics, help, and about in both search and playback
- shared pickers now support inline filtering, and browse input keeps terminal-style editing semantics
- anime episode catalogs now sort into ascending picker order while stream resolution still maps correctly against reverse-ordered upstream episode strings
- subtitle policy is restored in the new runtime, and the shell now surfaces when subtitles are disabled, attached, or not found
- canceling before first playback now returns to the previous browse result list instead of discarding search context
- settings now expose the default startup mode, and `src/main.ts` honors it unless CLI flags override it
- episode autoplay is now owned by the playback phase instead of mpv countdown/keep-open behavior, and it advances only to actually available released episodes
- integration tests, live smoke scripts, and VHS UI tapes now have a dedicated `test/` tree instead of drifting through `src/`
- browse results now open an in-shell details state before committing playback, which gives `Esc` a clearer parent context while the mounted root shell work continues
- the browse details state now uses an expanded overview panel with poster URL availability, rating when search metadata provides it, and explicit placeholders when provider-native sources omit detail fields
- subtitle status is now emitted before mpv launch and diagnostics explain the likely Vidking subtitle capture causes when no track is found
- browser/embed scraping now reuses the shared runtime cache instead of bypassing the new persistence layer
- browse and post-playback now host provider, help, about, history, and diagnostics panels inside the mounted shell instead of ejecting to separate helper shells
- post-playback episode selection now opens inside the playback shell and returns a selected season/episode without launching a separate helper shell

## Next Passes

### Pass A: Back-stack And Escape Correctness

Goal:

- make `Esc` mean clear, close, or go back, but never implicitly confirm or start playback

Tasks:

- thread true cancel results through `session-flow.ts`
- stop picker cancellation from falling back to default episode playback
- define parent-return behavior for season and episode pickers
- remove startup banner flicker caused by pre-Ink console logging

Status:

- mostly done for start-episode and post-playback episode picker cancellation
- startup banner flicker removed from `src/main.ts`
- still incomplete for the mounted root shell because browse, playback, and overlays are not yet one continuous back-stack

### Pass B: Mounted Root AppShell

Goal:

- stop treating home, browse, and playback as separate shell launches

Tasks:

- build a single mounted `AppShell`
- render home, browse, playback, and post-playback as content states
- keep the footer, command bar, and overlay host mounted across those states

Status:

- not done yet
- current code still launches separate shell sessions for browse and playback, even though they now share more state and action plumbing
- shell openings now render through one module-level Ink root host, so browse, playback, loading, and list surfaces swap root content instead of creating independent Ink roots
- interactive shell screens now remain visible until the next screen replaces them, reducing blank gaps between browse, picker, and playback states
- root-host screen replacements are keyed so local component state does not leak across mode/provider switches
- mode switching now uses one shared helper so the mode and its default provider change together in browse and playback paths
- browse and playback now share one runtime shell binding helper for provider options, settings persistence, and info-panel loaders
- post-playback no longer falls back to helper shells for provider, settings, history, diagnostics, help, or about because the playback shell handles those locally
- browse-side and post-playback secondary panels are now mounted in-shell
- playback still remains a separate shell session from browse, so the true root `AppShell` milestone is still open
- playback navigation now resolves `next`, `previous`, `next season`, and autoplay from actual provider or metadata availability instead of blindly incrementing episode numbers
- playback-side episode selection now stays inside that playback shell, reducing one more helper-shell handoff before the true root shell lands

### Pass B1: Fullscreen Layout Convergence

Goal:

- make every major workflow read as one fullscreen TUI with one dominant content region

Tasks:

- remove repeated full-width nested framing where a local sub-panel is enough
- define a viewport budget helper for:
  - header
  - content region
  - footer
  - overlay height
  - picker window size
- make browse prefer:
  - stacked layout on medium or narrow terminals
  - split list and companion layout only when width is truly sufficient
- make picker and overlay surfaces window to the viewport instead of overflowing into scrollback
- add explicit resize blockers for states that cannot stay legible below a minimum size
- ensure companion panes and helper copy collapse before the main task region does

Testing:

- deterministic layout-budget tests
- small-terminal smoke tests for picker and browse states
- manual verification for wide, medium, and too-small terminals

Exit criteria:

- users do not need terminal scrollback to use browse, picker, or settings flows
- the shell feels like one fullscreen app instead of stacked cards

### Pass C: Overlay Migration

Goal:

- move blocking picker-style helpers into true overlays

Tasks:

- settings overlay
- provider overlay
- history overlay
- diagnostics overlay
- season picker overlay
- episode picker overlay
- subtitle picker overlay

Status:

- partially done
- browse and post-playback now host provider, history, diagnostics, help, and about panels in the mounted shell
- browse and post-playback now host settings in-shell too, using the shared runtime config path instead of always ejecting into a blocking helper shell
- post-playback episode selection now stays in-shell
- settings, season, starting episode, and subtitle flows still rely on blocking shell helpers rather than true mounted overlays
- diagnostics now show recent runtime events from the new in-memory diagnostics store, which improves developer-mode inspection before the mounted overlay host lands
- picker states now keep the shared command layer and task-first footer guidance even while standalone list shells remain in the path
- settings and provider overlays now window around the selected row instead of hiding selected actions off-screen

### Pass C1: Command-Consistent Picker States

Goal:

- keep settings, help, history, diagnostics, and `/` command access reachable inside pickers and filter flows before the full overlay host lands

Tasks:

- make picker and list shells command-aware without breaking normal text filtering
- allow `/` in picker states even when a filter is active
- preserve filter text, selection, and focus when the command palette closes
- simplify picker footers into task-first guidance instead of long command rows
- add lightweight local picker header strips with context summaries

Exit criteria:

- picker flows no longer feel like a separate commandless mode
- settings and other nearby actions remain reachable without breaking text input

### Pass D: Naming And Provider Boundary Cleanup

Goal:

- reduce provider-architecture confusion before deeper hardening work

Tasks:

- rename `anime-base.ts` to `allanime-family.ts` and keep AllAnime-family naming explicit
- update docs and references so it is not mistaken for a generic anime-provider base
- reserve generic anime abstractions for shared concepts only

Status:

- done for code, tests, AGENTS routing, and core docs
- follow-up naming cleanup still applies if future providers introduce genuinely shared anime-provider abstractions

Tasks:

- replace freeform or separate-flow prompts with pickers where data is already known
- preserve playback context through transitions
- add inline loading and partial states instead of blank handoffs

Testing:

- focused integration tests for each migrated flow
- fixture-backed tests for metadata-driven pickers where relevant

Exit criteria:

- the user no longer bounces between multiple unrelated interaction models for core flows

## Phase 4: Data, Preview, And Performance Discipline

Goal:

- make the shell rich without becoming expensive or flaky

Tasks:

- separate stable metadata cache from volatile runtime cache
- add active-item plus neighbor prefetch rules
- add image preview service and capability ladder
- add cancellation and deduplication for preview work
- enforce responsive pane priority rules
- add reduced/performance mode behavior

Testing:

- cache policy tests
- in-flight dedupe and cancellation tests
- deterministic preview state tests
- responsive behavior tests with controlled dimensions

Exit criteria:

- details feel immediate
- expensive preview work never blocks navigation
- shell remains stable through resize and quick navigation

## Phase 5: Provider Hardening Integration

Goal:

- make provider work fit the shell and diagnostics model cleanly

Tasks:

- evolve providers toward candidate inventory instead of first-stream-only assumptions
- preserve subtitle, quality, audio, and mirror metadata where available
- make diagnostics show the resolution path clearly
- connect provider dossier workflow to implementation and tests

Testing:

- fixture-backed provider extraction tests
- subtitle and quality parsing tests
- failure-stage diagnostics tests

Exit criteria:

- provider improvements are composable and diagnosable instead of ad hoc

## Phase 6: Polish And Identity

Goal:

- make the shell feel premium without sacrificing clarity or performance

Tasks:

- add refined loader and status treatments
- add companion pane polish and image fallback behavior
- add fox mascot states and safe-path behavior
- add beta/about/help surfaces
- add local usage stats surfaces

Testing:

- state-driven UI tests
- low-motion and reduced-capability behavior checks
- manual verification for image backends and mascot feel

Exit criteria:

- the app feels cohesive, expressive, and stable under normal use

## Cross-Cutting Requirements

### Skill routing

Recommended skills while implementing:

- `make-interfaces-feel-better`
- `emil-design-eng`
- `frontend-design`
- `vercel-react-best-practices`
- official Ink docs for lifecycle or input specifics

### Test discipline

- prefer deterministic tests first
- reserve live provider checks for opt-in verification
- fixture-driven parser tests should be the default for provider logic
- add viewport-sensitive shell tests only around layout policy and visible-window calculations, not brittle screenshot snapshots by default
- avoid shipping architecture work that only "works manually" without lower-level test seams

### Documentation updates

When a phase changes a durable contract, update:

- `.docs/architecture*.md`
- `.docs/ux-architecture.md`
- `.docs/providers.md`
- `.docs/testing-strategy.md`
- the relevant provider dossiers or plan docs

## Milestone Definition Of Done

Each milestone should leave the repo in a state where:

- the next engineer can see the new source of truth quickly
- the change has at least one durable test seam
- docs match the actual intended direction
- new work does not need to guess whether to use the legacy path or the target path
