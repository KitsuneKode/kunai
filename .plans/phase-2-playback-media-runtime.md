# Kunai Phase 2 — Playback, Media Preview, and Provider Subtitle Runtime

Status: active design

This plan is the next runtime-quality checkpoint after the root shell and overlay migration.
It focuses on playback smoothness, provider-owned subtitle inventories, autoplay architecture,
and a reliable terminal image system.

## Goals

- Make playback feel immediate and trustworthy
- Reduce the time between "ready to launch" and visible `mpv` activity
- Treat subtitles as provider-owned structured inventory, not one-off URLs
- Make poster rendering reliable in Kitty/Ghostty and safe in fallback terminals
- Prepare the runtime for persistent autoplay chains without degrading manual playback UX

## Scope

In scope:

- `mpv` launch latency
- persistent autoplay architecture
- provider-specific subtitle inventory mapping
- poster/image backend separation
- runtime diagnostics for playback, subtitles, and image backends
- lightweight rolling verification during implementation

Out of scope for this phase:

- deep live-provider QA matrix
- full beta acceptance pass
- trailer/teaser implementation
- broad provider rewrites unrelated to playback/subtitle/media runtime

## Track 1 — Fast Playback Startup

### Current Problems

- Shell can appear to hand off before `mpv` is meaningfully active
- Extra remote subtitle URLs can stall startup before the player becomes visible
- Runtime currently mixes "launch requested" and "player active" into one mental phase

### Direction

- Keep the shell in `resolving` until `mpv` IPC is actually ready
- Launch with only the selected primary subtitle
- Attach additional subtitle tracks asynchronously after IPC is ready
- Keep startup work off the main thread and avoid idle-time polling churn

### Next Steps

1. Measure and log:
   - stream resolved timestamp
   - `mpv` spawned timestamp
   - IPC socket ready timestamp
   - first meaningful playback property timestamp
2. Surface those timings in diagnostics
3. Investigate whether `--force-window=immediate` is worth using for earlier visible activation
4. Keep subtitle attachment asynchronous and bounded

## Track 2 — Persistent Autoplay Session

### Current Problems

- Spawn-per-episode autoplay introduces extra startup latency and shell churn
- Manual interruption and natural EOF are still routed through the same broad player lifecycle

### Direction

- Keep spawn-per-play for manual single-item playback
- Introduce persistent `mpv` session only for autoplay chains
- Advance episodes with IPC `loadfile ... replace`
- Reattach next subtitle inventory using IPC after each episode swap

### UX Rules

- Manual `q` or explicit stop pauses the autoplay chain and returns to Kunai
- Natural EOF advances when autoplay is active
- Post-playback shell must always offer:
  - resume
  - replay
  - next
  - search
  - autoplay paused/resume indicator

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

### Vidking Rule

For Vidking specifically:

1. direct decrypted Videasy payload subtitles are primary
2. Wyzie is fallback only if payload has no subtitle inventory
3. automatic cache-hit subtitle refresh should stay disabled

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

### Important Decisions

- Raw Kitty/Ghostty graphics stays the primary backend
- `chafa` remains the fallback backend
- `kitten icat` can be considered later as an optional helper backend, not the main architecture
- TMDB size should be adaptive:
  - normal browse preview: `w342`/`w500`
  - expanded detail: `original` only when it earns the cost

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
  - subtitle attach timing
  - whether autoplay used respawn or persistent replace path
- Image diagnostics should expose:
  - backend selected
  - source fetch status
  - render status
  - placement cleared/replaced events when useful

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

### Why this split is better

- on-the-go checks prevent architectural drift and obvious breakage
- the later beta sweep is still the right place to judge feel, polish, and multi-feature coherence

## Exit Criteria

This phase is ready to hand off to broader beta QA when:

- `mpv` startup feels materially faster and more honest
- autoplay can keep a persistent player session for episode chains
- subtitle inventories are provider-normalized and diagnosable
- Kitty/Ghostty image preview is lifecycle-safe and layout-safe
- diagnostics tell us where latency and subtitle decisions came from
