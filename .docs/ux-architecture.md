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
- overlay pickers size against `OverlayLayoutProvider` inner viewport (`contentRows` / `contentColumns`), not raw terminal dimensions — see `apps/cli/src/app-shell/overlay-layout-context.tsx`
- playback surfaces should keep title, episode identity, provider, and subtitle state visible without making users infer where they are

### Fullscreen TUI consensus

- the app should read as one fullscreen TUI, not stacked floating cards on a terminal canvas
- there should be one dominant outer frame and one dominant content region
- nested bordered boxes should be treated as local sub-panels, not repeated full-width containers
- the shell should never rely on terminal scrollback for normal interaction
- if the terminal is too small for a workflow, show a resize blocker instead of half-rendering
- content should win over chrome as space gets tight:
  - primary list or active workflow
  - local context strip
  - companion preview
  - secondary helper copy
- companion panes should appear only when the viewport can support them without crowding the main task
- when a provider or result does not have real detail data, the shell should show a light preview rather than pretending there is a richer details state
- the fullscreen hierarchy should stay stable across browse, picker, overlay, and post-playback states

### Command philosophy

- `/` is the global entry point for actions
- post-playback should always expose a direct path back into a fresh search without quitting the app
- common operations should have short command aliases
- discovery commands should be explicit and safe:
  - `/recommendation` loads personalized discovery
  - `/calendar` loads releases airing today without provider resolution
  - `/random` spins a small browse tray and never starts playback by itself
- commands should be discoverable rather than hidden
- command ownership should live in one global router, not in each component independently
- `/` should stay available in every interactive state, including picker and filter flows
- command palettes should preserve the underlying filter or search text and restore focus exactly where the user left it
- command palettes should be lightweight overlays anchored under the header, not full-screen mode switches
- command palettes should open with an immediately highlighted default action and still support zero-typing keyboard browsing
- command palettes should group actions by `Global` and `Context` rather than by implementation source
- command palettes should imply the recommended action through default highlight rather than extra “recommended” noise in every row

### Hotkey philosophy

- `Ctrl+C`, `/`, `Esc`, and `?` are always-global
- hotkeys are contextual, not globally modeful
- use direct keys for high-frequency actions only
- do not hijack normal text-entry behavior
- if text input is focused, normal typing wins except for `Ctrl+C`, `/`, and `Esc`
- non-text states may expose direct hotkeys alongside `/`, but `/` is still the universal fallback
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

Settings secret and URL fields use a dedicated `inputMode` buffer in
`apps/cli/src/app-shell/settings/` — never the shared picker `filterQuery`.
Enter on a text row opens edit mode; a second Enter commits; Esc cancels.
Rows overridden by env vars show an `(env)` badge and cannot be edited in-app.

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

Browse should prefer shell-hosted panels for lightweight secondary flows such as:

- provider switch
- settings
- help
- about
- history snapshot
- diagnostics snapshot
- selected-title details and overview

This keeps the user anchored in the current query and result list while they inspect or adjust nearby state.

Title details should be honest about data quality:

- show overview, poster availability, rating, episode count, and provider facts when the source returned them
- promote local progress, offline availability, and broken local artifact state near the title summary when known
- show calendar entries as release facts, not playable guarantees
- show cached offline-ready History continuation as an explicit local action only when a durable
  downloaded job is addressable; Enter may launch that local file, while ordinary History actions
  retain their online intent
- show explicit unavailable placeholders when a provider-native result does not expose those fields
- keep actual Kitty/Ghostty image rendering outside the Ink render tree until the image-pane service owns layout, clearing, and flicker control
- never require image support for selection, playback, or episode navigation

Post-playback should use the same rule for lightweight panels so provider changes, history, diagnostics, help, and about do not break the user out of the current title context.
Settings should follow that same in-shell rule for browse and post-playback shells, even while deeper season, episode, and subtitle flows still finish their overlay migration.

Overlay behavior should stay disciplined:

- one primary overlay at a time
- one child picker or confirmation above it when needed
- `Esc` closes only the top overlay
- unrelated deep overlay chains are a smell
- `Esc` must never act like confirm or implicit playback start
- pickers should preserve their local filter, selection, and scroll state when command overlays open and close above them
- overlays and pickers should be windowed to the viewport, not allowed to push content into terminal scrollback

## Picker Filtering

- filterable pickers are the default for season, episode, provider, subtitle, history, and settings flows
- picker filtering should keep terminal-style editing semantics where practical
- if a picker filter is non-empty, the first `Esc` clears the filter and the second `Esc` closes the picker
- picker states should keep a compact local title strip with:
  - task title, like `Choose episode`
  - one short context line, like `Season 2 · 12 episodes`
- picker rows should stay dense and single-line by default
- selected-item detail should live in a companion or selection panel, not by expanding every row
- when a picker is active, the picker owns interaction but should keep a lighter selection or companion panel visible when space allows

## Validation And Reliability

- UI actions should dispatch validated commands
- async work should surface clear status changes
- disabled states should be explicit
- recoverable failures should offer direct next steps
- diagnostics should be accessible to users, not hidden behind debug-only knowledge
- first-run dependency issues should surface inside the shell before escalating to a dedicated setup overlay

Playback command vocabulary is intentionally narrow:

- `restart` / `replay` is local playback control. It starts the same episode from the beginning and should not force provider refetch by default.
- `recover` is repair. It treats the current stream as suspect, refetches the same playback intent, and resumes near the last trusted position before trying fallback.
- `refresh source` is an advanced diagnostics action. It may try a fresh provider resolve, but it must preserve the current playable cached stream when no better source is found.
- `fallback` changes source/provider after recovery fails or when the user explicitly asks for another provider.

Short-lived playback feedback should use mpv OSD plus shell status text for non-blocking outcomes such as `No fresher source found. Continuing current stream.` Full loading or error screens are for broken playback, not healthy-playback refresh misses.

## Settings Behavior

- settings apply immediately after a row interaction commits
- `Esc` cancels active text input, backs out of submenus, or closes the
  settings shelf; it does not roll back values already applied to config
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
- source refresh / recover / fallback decisions
- subtitle source and selected track
- language switch path, especially whether the request was an mpv soft-subtitle switch, cached stream reload, or provider lookup
- scrape timing
- retry and fallback history
- capability state for `mpv`, Playwright, and image backends
- offline runway, storage-reserve pauses, and maintenance waiting reasons; expose bounded
  decision summaries only, never local paths, stream URLs, request headers, or subtitle URLs

Autoplay and next/previous actions should follow real episode availability from provider or metadata catalogs, not guessed episode numbers.

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
- treat Kitty/Ghostty graphics as an enhancement, not an assumption
- do not auto-fallback to terminal block-art poster renderers; show a clear unsupported state instead
- load posters lazily and never block interaction for them
- preserve a strong plain-text fallback path
- footers should avoid long horizontal action sentences
- default footer layout should be two lines:
  - line 1: current task, optionally with one short context suffix
  - line 2: 3-4 live shortcuts plus `/ commands`
- minimal footer mode should keep line 1 and collapse line 2 into a smaller shortcut strip
- footer density should be configurable between `detailed` and `minimal`
- the footer should show only actions that are usable right now
- disabled actions belong in the command palette and help overlay, not the persistent footer
- the command palette should temporarily replace footer content with palette-specific guidance while open
- quit should use a brief exit treatment, not a long goodbye screen
- preferred exit treatment:
  - soft shell dim
  - footer drops away first
  - optional tiny mascot reaction
  - one short closing line
  - total runtime under roughly `180–220ms`
- `Ctrl+C` should remain near-instant and should not wait on decorative exit motion
- reduced or minimal modes should simplify or skip exit motion entirely
- high-frequency shell actions like picker navigation, command palette open, and search focus should avoid decorative animation
- fullscreen transitions should favor instant layout stability over flourish
- the shell should feel denser and calmer over long sessions, especially during episode browsing and repeated picker use

## Anti-Patterns

- mixing multiple interaction models in the same primary flow
- hidden timed key windows
- blocking setup wizards for common adjustments
- asking for raw values when structured data already exists
- decorative animation that delays interaction
