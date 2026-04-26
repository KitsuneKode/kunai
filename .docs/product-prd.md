# KitsuneSnipe — Product PRD

Last updated: 2026-04-23

Use this doc as the product and UX source of truth for the next major passes. It captures what KitsuneSnipe is trying to become, the user experience we are aiming for, and the implementation constraints that matter.

For the shorter user-facing scope and support overview, read [.docs/experience-overview.md](./experience-overview.md).

## Product Summary

KitsuneSnipe is a terminal-first streaming browser and playback launcher.

The target product is not "a pile of prompts that eventually launches `mpv`."
It is a cohesive, keyboard-native media shell that feels closer to a lightweight terminal Netflix:

- fast to browse
- clear while resolving
- safe during failures
- expressive without being messy
- diagnosable when providers drift

## Product Goals

- let users search, inspect, select, and play content without losing context
- keep high-frequency actions reachable from anywhere
- make playback, provider changes, subtitles, and next-episode flow feel intentional
- preserve a premium browsing feel in a TUI through layout, details, imagery, and polish
- make failures recoverable and explainable instead of opaque
- keep provider support extensible and hardenable without codebase sprawl

## Non-Goals

- a modal prompt wizard
- a hidden-hotkey power-user-only tool
- a screen-scraper that only works by tribal knowledge
- a UI that depends on images, motion, or perfect terminal capabilities to function
- an account-required product
- a media host, mirror, uploader, or content distribution service

## Primary User Experience

The target interaction model is one persistent shell.

Core shell regions:

- header
- compact status strip
- main content area
- footer action bar
- command bar
- shallow overlay stack
- optional companion pane for details and imagery

The app should feel like one cockpit, not a sequence of separate mini-tools.

## Core Product Decisions

### Persistent shell

- the shell stays mounted for the whole session
- flows change shell state instead of replacing the whole runtime
- `mpv` gets terminal ownership during playback, then the shell resumes with context intact

### Global commands and hotkeys

- `/` opens the command bar from anywhere
- `Esc` owns close and back behavior
- `q` is reserved for quitting from root contexts
- high-frequency actions get direct keys
- lower-frequency actions can live behind an explicit leader mode if needed

### Overlays

- settings, provider picker, history, diagnostics, season picker, episode picker, subtitle picker, and confirmations are overlays or large panels in the same shell
- overlay stacks stay shallow
- one primary overlay plus one child confirmation or picker is the preferred limit

### Search and browsing

- search input remains visible
- command bar is separate from search
- results use dense rows plus a strong selected-state companion pane
- details update immediately
- expensive preview work is debounced

### Images and companion pane

- images are enhancement, not dependency
- the companion pane is details-first
- images appear inside that pane when supported and space allows
- if image rendering is unavailable, the same slot becomes a richer details pane

### Responsive behavior

- degrade layout before throwing blockers
- prioritize the main list and input flow over images and diagnostics
- auto-collapse secondary panes when space is tight
- auto-restore only when the layout system collapsed them, not when the user intentionally hid them

### Loading and diagnostics

- loading should feel active, not blocking
- users should see what the app is doing while remaining able to navigate when safe
- compact runtime state stays visible
- deeper explanations live in diagnostics

### Settings

- staged `Save` and `Cancel`
- settings declare when they take effect:
  - immediate
  - next playback
  - requires re-resolve
- recovery behavior should be configurable instead of hardcoded forever

### Provider work

- non-trivial provider work is dossier-first
- new providers and hardening passes should preserve evidence, knowns vs unknowns, and regression cases
- provider support should expand toward multi-source, subtitles, quality, and dub/audio metadata, not just "first playable stream"

### Privacy and reports

- diagnostics are local-first
- traces and reports should be privacy-safe
- no automatic upload
- export is explicit and user-controlled

## User-Facing Feature Areas

### Browse and play

- search titles
- inspect details
- pick provider
- select season or episode
- launch playback
- return to a contextual post-playback panel

### Recovery and diagnostics

- retry
- provider switch
- diagnostics overlay
- explicit subtitle and resolve status
- capability/setup blocker flow

### Personal layer

- continue watching
- watch history
- local usage stats
- future export and sync hooks

### Future integrations

- MAL
- AniList
- IMDb
- TMDB

These should be optional sync adapters, not the product's core source of truth.

## Experience Quality Bar

The shell should feel:

- stable during resize and tiling
- fast during list navigation
- readable at multiple terminal sizes
- polished without animation excess
- emotionally expressive where it helps, including the fox mascot

The shell should not feel:

- flat and dead
- visually noisy
- hidden-mode-heavy
- fragile when providers drift
- blocked on expensive preview work

## Mascot Direction

KitsuneSnipe can support a fox companion with bounded behavior:

- state-driven animation and captions
- safe movement paths only in non-critical shell regions
- reacts mostly to milestone events, not every keystroke
- disabled or simplified in reduced/performance modes

The mascot is part of the atmosphere, not part of the control model.

## Success Criteria For The Next Passes

- one clear runtime migration path exists
- shell interaction rules are documented and implemented without ad hoc drift
- provider research and implementation have a repeatable workflow
- tests focus on deterministic state, parsing, and contracts rather than flaky theater
- future contributors can add providers or refactor core shell services without relearning the whole system from scratch

## Primary Implementation References

- runtime architecture: [.docs/architecture.md](./architecture.md)
- target architecture: [.docs/architecture-v2.md](./architecture-v2.md)
- shell UX rules: [.docs/ux-architecture.md](./ux-architecture.md)
- engineering rules: [.docs/engineering-guide.md](./engineering-guide.md)
- testing rules: [.docs/testing-strategy.md](./testing-strategy.md)
- implementation sequencing: [.plans/persistent-shell-implementation.md](../.plans/persistent-shell-implementation.md)
