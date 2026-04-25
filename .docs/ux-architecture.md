# KitsuneSnipe — UX Architecture

Use this doc when designing terminal interactions, keybindings, panels, command flows, and validation behavior.

## Design Goals

- keep the app fast for repeated daily use
- keep the interaction model consistent across flows
- keep important actions reachable from anywhere
- reduce avoidable user errors with structured selection and validation
- make failure paths understandable and recoverable
- add visual polish without introducing jank or blocking behavior

## Interaction Model

KitsuneSnipe should behave like a terminal app shell, not a sequence of unrelated prompts.

### Core layout

- header for current context and status
- content area for the active workflow
- footer for stable core actions plus contextual hotkeys
- compact status strip for user-critical runtime state
- command bar for global actions
- overlays for secondary flows

### Command philosophy

- `/` is the global entry point for actions
- common operations should have short command aliases
- commands should be discoverable rather than hidden
- command ownership should live in one global router, not in each component independently

### Hotkey philosophy

- `Ctrl+C`, `/`, `Esc`, and `?` are always-global
- hotkeys are contextual, not globally modeful
- use direct keys for high-frequency actions only
- do not hijack normal text-entry behavior
- if text input is focused, normal typing wins except for `Ctrl+C`, `/`, and `Esc`
- prefer explicit leader mode over hidden timed key chords
- if an action is unavailable, show why instead of silently ignoring the input
- mode actions should be phrased by destination, like `Anime mode` or `Series mode`, instead of generic toggle wording

## Selection Over Freeform Input

If the app already knows the valid options, the UI should present those options instead of asking the user to type raw values.

This applies especially to:

- providers
- seasons
- episodes
- subtitle tracks
- settings choices

Search query and command input remain valid uses of text fields.

## Panels And Overlays

Preferred overlay or panel flows:

- settings
- history
- diagnostics
- provider switcher
- season picker
- episode picker
- subtitle picker

These should feel like parts of the same application, not separate tools launched from the side.

Overlay behavior should stay disciplined:

- one primary overlay at a time
- one child picker or confirmation above it when needed
- `Esc` closes only the top overlay
- unrelated deep overlay chains are a smell
- `Esc` must never act like confirm or implicit playback start

## Picker Filtering

- filterable pickers are the default for season, episode, provider, subtitle, history, and settings flows
- picker filtering should keep terminal-style editing semantics where practical
- if a picker filter is non-empty, the first `Esc` clears the filter and the second `Esc` closes the picker

## Validation And Reliability

- UI actions should dispatch validated commands
- async work should surface clear status changes
- disabled states should be explicit
- recoverable failures should offer direct next steps
- diagnostics should be accessible to users, not hidden behind debug-only knowledge
- first-run dependency issues should surface inside the shell before escalating to a dedicated setup overlay

## Settings Behavior

- prefer staged edits with `Save` and `Cancel`
- label settings by effect timing:
  - immediate
  - next playback
  - requires re-resolve
- avoid restart-required settings unless there is no safer option
- recovery behavior should be configurable through explicit user-facing patterns rather than buried in hardcoded fallback logic

Recommended recovery-pattern values:

- `guided`
- `fallback-first`
- `manual`

## Status Density

Show compact always-visible state for:

- provider
- mode
- current title and episode
- subtitle state
- resolve state
- memory RSS

Keep deeper detail in a diagnostics overlay:

- cache / prefetch / fresh scrape / API path
- subtitle source and selected track
- scrape timing
- retry and fallback history
- capability state for `mpv`, Playwright, and image backends

## Setup Guardrails

- auto-detect missing dependencies
- never silently install system dependencies
- prefer an inline blocker card first
- open a setup overlay only when the user asks for detail or installation
- support `Install`, `Skip`, and `Don’t ask again`

## Visual And Motion Rules

- polish should support comprehension, not distract from it
- use subtle transitions for overlays, loaders, and status changes
- keep motion interruptible and cheap
- treat Kitty graphics and `chafa` as enhancements, not assumptions
- load posters lazily and never block interaction for them
- preserve a strong plain-text fallback path
- footers should wrap and group actions cleanly instead of forcing one long horizontal command sentence

## Anti-Patterns

- mixing multiple interaction models in the same primary flow
- hidden timed key windows
- blocking setup wizards for common adjustments
- asking for raw values when structured data already exists
- decorative animation that delays interaction
