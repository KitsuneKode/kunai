# Kunai Phase 2 — Playback, Media Preview, and Provider Subtitle Runtime

Status: active implementation

This plan is the next runtime-quality checkpoint after the root shell and overlay migration.
It focuses on playback smoothness, provider-owned subtitle inventories, autoplay architecture,
and a reliable terminal image system.

## Goals

- Make playback feel immediate and trustworthy
- Reduce the time between "ready to launch" and visible `mpv` activity
- Treat subtitles as provider-owned structured inventory, not one-off URLs
- Make poster rendering reliable in Kitty/Ghostty and safe in fallback terminals
- Prepare the runtime for persistent autoplay chains without degrading manual playback UX
- Give shell and `mpv` one shared playback controller instead of overlapping partial ownership
- Make quit, next, previous, resume, replay, and autoplay pause semantics explicit and predictable
- Prepare for IntroDB-powered recap/intro/credits timing without hard-coding skip behavior into the shell

## Scope

In scope:

- `mpv` launch latency
- persistent autoplay architecture
- provider-specific subtitle inventory mapping
- poster/image backend separation
- runtime diagnostics for playback, subtitles, and image backends
- playback session state ownership
- quit-threshold policy
- shell-controlled next/previous while playback is active
- abortable resolve / scrape / subtitle work
- IntroDB timing metadata plumbing
- lightweight rolling verification during implementation

Out of scope for this phase:

- deep live-provider QA matrix
- full beta acceptance pass
- trailer/teaser playback implementation
- broad provider rewrites unrelated to playback/subtitle/media runtime
- full detached background playback / mini-player mode

## Product Decisions Locked For This Phase

These are the defaults the runtime should implement unless the user changes settings:

1. `autoNext` is enabled by default.
2. Manual single-item playback is still supported and should stop cleanly at EOF.
3. Manual quit near the end of an episode should count as complete by default.
4. Manual quit mid-episode should pause autoplay for the current chain only.
5. Shell next/previous during playback should control the same active player instance.
6. Subtitle inventory should stay fully attached and switchable in `mpv`, but the selected default track must respect runtime config.
7. IntroDB timing should influence skip affordances and near-end logic when available.

## Architecture Shape

Playback should be split into four explicit layers:

### 1. `PlaybackSessionController`

Owns:

- current title / season / episode identity
- playback mode: manual vs autoplay-chain
- autoplay state: active / paused / disabled-for-session
- quit-near-end policy
- stop-after-current flag
- queued next / previous targets
- resume point and completion state
- current player session id

This is the single source of truth for playback state.

### 2. `MpvSession`

Owns:

- `mpv` process lifecycle
- IPC connection lifecycle
- `loadfile ... replace`
- pause / resume / stop / quit
- subtitle add / remove / reload
- readiness, file-loaded, eof, and quit events

This must not decide episode state on its own.

### 3. `ResolvePipeline`

Owns:

- current episode resolve
- next / previous resolve
- provider fallback
- subtitle inventory resolution
- IntroDB timing fetch
- abortable scrape / decode / network work

### 4. `Shell`

Owns:

- rendering
- command dispatch
- overlays
- diagnostics
- user-facing copy

The shell must never become the hidden source of truth for playback progression.

## Phase Breakdown

### Phase 2A — Playback Session Controller

Goal:
- create the controller that unifies shell intent and player events

Deliverables:
- `PlaybackSessionController` type and state machine
- explicit intents:
  - `play`
  - `stop`
  - `quit`
  - `resume`
  - `replay`
  - `next`
  - `previous`
  - `pauseAutoplay`
  - `resumeAutoplay`
  - `stopAfterCurrent`
  - `queueTitleAfterCurrent`
- explicit events:
  - `playerSpawned`
  - `ipcReady`
  - `fileLoaded`
  - `playbackProgress`
  - `nearEndReached`
  - `naturalEof`
  - `manualQuit`
  - `resolveFailed`

Acceptance:
- shell and `mpv` no longer each infer autoplay state independently
- `PlaybackPhase` becomes thinner and delegates state decisions to the controller

Progress:
- pure controller decisions are extracted into `playback-session-controller.ts`
- playback session state now explicitly models manual vs autoplay-chain mode
- stop-after-current and session-local autoplay pause now flow through that controller seam

### Phase 2B — Persistent Autoplay Player Session

Goal:
- stop respawning `mpv` between autoplay episodes

Deliverables:
- keep spawn-per-play for manual single-item playback
- persistent `MpvSession` for autoplay chains
- use `loadfile <url> replace`
- clear and reattach subtitle inventory after replace
- update title / episode metadata after each replace

Acceptance:
- autoplay chains stay inside one player process for normal episode-to-episode advance
- shell next/previous while playing reuse the same active player session

Progress:
- autoplay-chain playback now reuses a persistent mpv session
- shell `next` / `previous` / `refresh` / `fallback` stop the current file when possible instead of always killing the process
- post-playback and phase teardown now explicitly release the persistent session so idle mpv processes do not linger

### Phase 2C — Quit Threshold and Manual Interruption Policy

Goal:
- remove the current ambiguity around `q`

Defaults:
- natural EOF + autoplay active => advance
- natural EOF + manual playback => return to shell
- manual quit mid-episode => save resume, pause autoplay for session
- manual quit near end => treat as complete

Settings to add:
- `quitNearEndBehavior`
  - `continue`
  - `pause`
  - `ask`
- `quitNearEndThresholdMode`
  - `credits-or-90-percent`
  - `percent-only`
  - `seconds-only`

Acceptance:
- quit behavior is explainable from config + progress state alone

Progress:
- credits timing now overrides the old blunt near-end threshold when IntroDB metadata exists
- fallback completion logic now uses the final 5 seconds instead of the older hardcoded window

### Phase 2D — Interactive Playback Controls

Goal:
- make the playback shell active, not passive

Required actions during playback:
- `a` pause / resume autoplay
- `n` next episode now
- `p` previous episode now
- `x` stop after current episode
- `s` subtitle actions
- `/` command palette
- `q` stop current episode
- `r` refresh source
- `f` fallback provider

Recommended later action:
- queue another title after current episode without full detach

Acceptance:
- active playback shell remains useful without forcing users to wait for playback to end

Progress:
- playback shell live controls for next/previous/autoplay pause/stop-after-current are already wired through the shared control service

### Phase 2E — Abortable Resolve and Scrape Work

Goal:
- make in-flight work cancellable

Required:
- `AbortController` support for:
  - search
  - stream resolve
  - subtitle resolve
  - next-episode pre-resolve
  - provider fallback
- shell cancel actions should actually stop background work, not just hide the state

Acceptance:
- users can back out of expensive resolve paths without leaving zombie jobs

Progress:
- phase-level abort signals now flow through session controller -> phase context -> search/provider/timing calls
- provider search, registry search, provider resolve, IntroDB timing fetch, and anime episode catalogs now receive the shared signal
- full interactive shell cancel during loading is still the remaining sub-slice here

### Phase 2F — IntroDB Timing Metadata

Goal:
- add timing metadata plumbing without over-coupling it to current playback code

Source:
- `https://api.theintrodb.org/v2/media?...`

Data model:
- recap windows
- intro windows
- credits windows
- preview windows

Initial use:
- auto-skip recap when enabled
- auto-skip intro when enabled
- use credits start as the preferred near-end threshold when available
- expose shell-level status like `intro skipped` / `next episode soon`

Out of scope here:
- fancy on-player overlays
- user-contributed timing editor

Acceptance:
- timing metadata can affect quit threshold and skip logic without hard-coding title-specific branches

Progress:
- IntroDB timing is already used for completion/near-end decisions
- recap/intro/preview skip affordances are still the remaining user-facing slice

## Track 1 — Fast Playback Startup

### Current Problems

- Shell can appear to hand off before `mpv` is meaningfully active
- Extra remote subtitle URLs can stall startup before the player becomes visible
- Runtime currently mixes "launch requested" and "player active" into one mental phase
- repeated episode respawn adds unavoidable window/open overhead even when autoplay is active

### Direction

- Keep the shell in `resolving` until `mpv` IPC is actually ready
- Launch with only the selected primary subtitle
- Attach additional subtitle tracks asynchronously after IPC is ready
- Keep startup work off the main thread and avoid idle-time polling churn
- move autoplay chains to `loadfile replace` so most episode changes avoid cold player startup

### Next Steps

1. Measure and log:
   - stream resolved timestamp
   - `mpv` spawned timestamp
   - IPC socket ready timestamp
   - `file-loaded` timestamp
   - first meaningful playback property timestamp
   - subtitle attach completion timestamp
2. Surface those timings in diagnostics
3. Investigate whether `--force-window=immediate` is worth using for earlier visible activation
4. Keep subtitle attachment asynchronous and bounded
5. Add a distinct shell phase for:
   - launching player
   - opening stream
   - player ready
   - now playing

### Tradeoffs

- `--force-window=immediate` may make the player feel faster but could show a blank window earlier
- waiting for `file-loaded` or first playback signal is more honest but may feel slightly slower in the shell
- persistent player sessions reduce launch latency but increase controller complexity

## Track 2 — Persistent Autoplay Session

### Current Problems

- Spawn-per-episode autoplay introduces extra startup latency and shell churn
- Manual interruption and natural EOF are still routed through the same broad player lifecycle
- next / previous during playback still want to behave like shell commands, not player-session commands

### Direction

- Keep spawn-per-play for manual single-item playback
- Introduce persistent `mpv` session only for autoplay chains
- Advance episodes with IPC `loadfile ... replace`
- Reattach next subtitle inventory using IPC after each episode swap
- Let shell next / previous actions target the same live player session when one exists

### UX Rules

- Manual `q` or explicit stop pauses the autoplay chain and returns to Kunai
- Natural EOF advances when autoplay is active
- Manual quit near end follows the configured near-end policy
- Post-playback shell must always offer:
  - resume
  - replay
  - next
  - search
  - autoplay paused/resume indicator
  - stop-after-current state when relevant

### Tradeoffs

- Persistent sessions dramatically reduce autoplay latency but add more states to reason about
- Replacing media in-place means subtitle and timing metadata must be carefully refreshed or stale state will leak
- Manual playback should stay simpler, even if that means keeping spawn-per-play there

## Track 3 — Provider-Owned Subtitle Inventory

### Principle

Subtitles are not one global resolver problem. They are provider-shaped inventory that needs
provider-specific mapping and normalization.

### Rules

- Each provider can expose subtitles differently:
  - direct payload array
  - embed-side API response
  - observed direct file URLs
  - fallback service such as Wyzie
- Runtime should normalize provider subtitle inventory into one shared shape:
  - `url`
  - `language`
  - `display`
  - optional release/source evidence
- Preferred subtitle selection should work from normalized inventory, not from ad-hoc string checks

### Required Work

1. Add provider-specific normalization helpers where needed
2. Support field mapping such as:
   - `url`
   - `src`
   - `file`
   - `href`
3. Support language normalization via:
   - exact codes
   - common names
   - provider-specific labels
   - regex cleanup like `English SDH`, `ENG`, `English (CC)`
4. Keep full inventory in `subtitleList`
5. Keep selected item in `subtitle`
6. Record evidence for where the inventory came from:
   - provider-direct
   - observed direct file
   - Wyzie fallback
   - absent in source
7. Ensure default selected track is chosen from full inventory using the runtime config language, not whichever track was attached last
8. Preserve enough metadata to distinguish:
   - built-in / embedded subtitles
   - external subtitles
   - provider-direct sidecar subtitles

### Track Selection Rules

- Launch `mpv` with only the selected preferred subtitle
- Attach all remaining tracks lazily with passive `sub-add auto`
- Never let lazy attachment change the selected default track
- If a full subtitle inventory exists, config language wins over stale provider-default selection
- Refresh subtitle inventory only on explicit user intent or explicit provider-refresh flows

### Vidking Rule

For Vidking specifically:

1. direct decrypted Videasy payload subtitles are primary
2. Wyzie is fallback only if payload has no subtitle inventory
3. automatic cache-hit subtitle refresh should stay disabled
4. subtitle links should be cached together with stream results until the user explicitly reloads subtitles or refreshes the source

## Track 4 — Terminal Image Runtime

### Current Problems

- Poster source fetching, caching, rendering, and placement are still mixed together
- Kitty image cache ownership can drift from real image lifecycle
- View components still know too much about preview cleanup

### Direction

Split poster handling into three layers:

1. `PosterSourceCache`
   - fetches and caches image source bytes or file metadata
   - never stores live terminal placement state
2. `PosterRenderer`
   - `kitty-graphics`
   - `chafa-text`
   - optional future helper backend
3. `PosterPlacementController`
   - one root-owned place responsible for render/replace/clear semantics
   - one root-owned place responsible for render/replace/clear semantics
   - later responsible for richer poster lifecycle, trailer metadata hooks, and companion-pane transitions

### Important Decisions

- Raw Kitty/Ghostty graphics stays the primary backend
- `chafa` remains the fallback backend
- `kitten icat` can be considered later as an optional helper backend, not the main architecture
- TMDB size should be adaptive:
  - normal browse preview: `w342`/`w500`
  - expanded detail: `original` only when it earns the cost

### Remaining Work

1. move current preview hook toward a root-owned placement controller
2. stop view components from knowing about placement lifecycle
3. add diagnostics for:
   - source cache hit/miss
   - backend selected
   - upload/render time
4. keep trailer / teaser support out of the image renderer itself

## Track 5 — Diagnostics and Runtime Introspection

### Needed

- Clear distinction between:
  - cache hit
  - cache hit with subtitle inventory already attached
  - provider-direct subtitle inventory
  - fallback subtitle inventory
  - real scrape miss
- Playback diagnostics should expose:
  - spawn latency
  - IPC ready latency
  - file-loaded latency
  - subtitle attach timing
  - whether autoplay used respawn or persistent replace path
  - whether quit was treated as complete vs interruption
- Image diagnostics should expose:
  - backend selected
  - source fetch status
  - render status
  - placement cleared/replaced events when useful
- Resolve diagnostics should expose:
  - in-flight task count
  - abort/cancel reason
  - next-episode pre-resolve result

## Track 6 — Intro / Credits / Preview UX

### Goal

Use IntroDB metadata to make playback feel more premium without making the player logic magical or fragile.

### UX Rules

- If recap timing is active and auto-skip is enabled, skip recap automatically.
- If intro timing is active and auto-skip is enabled, skip intro automatically.
- If intro or recap timing exists but auto-skip is disabled, surface a clear skip action while the window is active.
- If credits timing exists and autoplay is active, treat credits start as the preferred near-end threshold.
- Preview windows should be metadata-only for now; no autoplay behavior should depend on preview windows in this phase.

### Settings To Add

- `autoSkipRecap`
- `autoSkipIntro`
- `creditsAdvanceMode`
  - `autoplay-only`
  - `always-complete`
  - `disabled`

### Tradeoffs

- Metadata-driven skipping feels premium, but timing data can be absent or imperfect
- Skip logic must remain transparent and overridable
- If data is missing, fallback behavior should still be sane

## Track 7 — Future Trailer / Teaser Support

This phase should only lay the groundwork.

Needed groundwork:
- keep poster/media metadata services separable
- avoid baking “poster only” assumptions into preview APIs
- preserve a place to store trailer metadata from TMDB or provider sources

Deferred:
- actual trailer playback
- inline video preview
- trailer queues or autoplay

## QA Strategy

Do not postpone all testing until the end, and do not over-invest in the full live QA matrix on
every single patch.

### Recommended split

During implementation:

- keep lightweight rolling checks on the go
- run typecheck/lint/tests
- do focused smoke checks for the feature being changed
- verify architecture decisions before they sprawl

At first beta checkpoint:

- run the experiential QA sweep
- exercise the app as a user:
  - browse
  - playback
  - history resume
  - autoplay chains
  - poster preview
  - subtitle selection
  - provider switching
- capture roughness, latency, state drift, and "feels wrong" issues together

### Best place for experiential testing

The first beta-ready checkpoint is the best place to deeply test:

- playback feel
- autoplay flow
- next/previous while active
- quit-near-end behavior
- intro/recap skipping
- poster preview stability
- subtitle selection and switching

That is the right moment to validate overall coherence and “feel”.

Until then, implementation should still keep:

- typecheck
- lint
- unit / integration coverage
- focused smoke tests on the feature currently being changed

### Why this split is better

- on-the-go checks prevent architectural drift and obvious breakage
- the later beta sweep is still the right place to judge feel, polish, and multi-feature coherence

## Exit Criteria

This phase is ready to hand off to broader beta QA when:

- `mpv` startup feels materially faster and more honest
- autoplay can keep a persistent player session for episode chains
- shell next / previous can control the active player session safely
- quit behavior is threshold-aware and configurable
- subtitle inventories are provider-normalized and diagnosable
- subtitle default selection respects runtime config while keeping the full inventory switchable
- Kitty/Ghostty image preview is lifecycle-safe and layout-safe
- abortable resolve / scrape paths are in place for interactive shell recovery
- IntroDB timing metadata influences skip and near-end policy cleanly
- diagnostics tell us where latency and subtitle decisions came from
