# CLI UX Overhaul Plan

Status: Planned

Use this plan when improving the terminal interaction model, migrating core flows to Ink, or reducing blocking prompt-driven UX.

## Goal

Turn KitsuneSnipe from a chain of prompts into a coherent terminal app shell:

- one persistent layout
- one interaction model
- global access to key actions
- constrained pickers instead of error-prone freeform input
- strong validation and diagnostics
- premium feel without sacrificing speed or reliability

## Product Decisions

These are the current decisions and should be treated as the default direction unless the project intentionally changes them.

- Default landing state is a focused search view with visible command and hotkey affordances
- `/` opens a command bar from anywhere
- Settings, history, provider switcher, diagnostics, and pickers are overlays or panels, not separate prompt flows
- Playback remains inside the same app shell instead of switching to a separate menu mode
- Season and episode selection come from fetched metadata in normal flow
- Provider switching should be globally reachable when the current state makes it safe
- Diagnostics should be visible to normal users in a compact panel
- Terminal images are optional enhancement, not a dependency for core UX
- The product is optimized for repeated daily use over first-run theatrics
- Keyboard interaction should use contextual hotkeys plus the command bar, not a globally modeful Vim clone

## Problems In The Current UX

- The app currently mixes raw key reads, `@clack/prompts`, and `fzf`, so the user keeps crossing interaction models
- Important actions are not globally reachable
- Some flows rely on invisible timing or hidden behavior
- Settings and other configuration steps are too blocking
- Metadata-backed choices like seasons and episodes are not consistently treated as structured selections
- Failure handling is mostly textual rather than action-driven
- Picker and menu logic are repeated in multiple places

## Target UX Model

### App shell

- `Header`: app identity, mode, provider, current title, network or resolution status
- `Content`: search results, picker content, playback state, history, or diagnostics
- `Footer`: contextual hotkeys and discoverable actions
- `CommandBar`: command-prefix interface for global actions
- `OverlayPanel`: settings, provider switcher, episode picker, season picker, history, logs

### Interaction rules

- High-frequency actions get direct hotkeys
- Global actions are always reachable through `/`
- Text input is only used for search and commands
- If the app already knows the valid options, it should present a picker instead of asking for raw input
- Disabled actions should explain why they are disabled
- The UI should not rely on invisible timing windows for action discovery

### Reliability and diagnostics

- Async actions should expose structured states: `idle`, `loading`, `success`, `error`
- Stream resolution should show enough context to explain whether the app used cache, prefetch, fresh scrape, or API resolution
- Failure states should offer direct next actions such as retry, switch provider, open diagnostics, or go back

## Architecture Changes

### Phase 0: Interaction architecture first

- define a single `AppState`
- define explicit `Action` or command handlers
- centralize selection and validation logic
- create a shared metadata store for title, season, episode, and provider-related selection state
- remove hidden or one-off interaction paths where possible

This phase should start before or alongside the Ink migration. Do not wait until after a full port to fix the state model.

### Phase 1: Ink shell foundation

- introduce an Ink app shell
- add persistent header, content area, footer, and overlay system
- add a global command bar
- keep the shell mounted across search, selection, playback state, and post-playback actions

This is the point where “actions available from anywhere” becomes real.

### Phase 2: Migrate highest-friction flows

- search flow
- provider switching
- settings
- season picker
- episode picker
- subtitle picker
- post-playback actions
- history and diagnostics panels

The goal is to stop mixing `clack`, `fzf`, and custom raw-mode screens as peers.

### Phase 3: Remove repeated logic

- unify picker behavior behind a single searchable picker abstraction
- extract repeated provider-selection and menu-action logic
- centralize validation and capability checks
- centralize metadata fetching, caching, and refetch rules

### Phase 4: Premium polish

- premium loading states
- motion rules for overlays and status transitions
- fox-themed startup and loader treatment
- Kitty graphics and `chafa` progressive enhancement
- reduced-motion and low-capability fallbacks

## Component and Module Targets

### UI components

- `AppShell`
- `HeaderBar`
- `FooterActions`
- `CommandBar`
- `OverlayPanel`
- `SearchView`
- `SearchablePicker`
- `SettingsPanel`
- `HistoryPanel`
- `DiagnosticsPanel`
- `PlaybackStatusView`

### State and services

- `app-state`
- `command-registry`
- `capability-service`
- `catalog-store`
- `provider-resolution-service`
- `playback-session-service`
- `diagnostics-store`

## Validation Rules

- Prefer structured choice over freeform input whenever valid options are already known
- Season and episode selection should always be metadata-backed in normal flow
- Unsafe actions should be blocked before execution rather than rejected afterward
- Provider switching should respect the current playback or resolve state
- Missing capability states such as no Kitty graphics or no `chafa` should degrade cleanly without breaking the shell

## Capability Strategy

- Plain terminal rendering is the baseline
- Kitty graphics protocol is an enhancement path
- `chafa` is a fallback enhancement path
- Motion should be subtle and automatically degradable

## Success Criteria

- The user can access settings, provider switching, history, and diagnostics from anywhere in the app
- The core flow requires fewer blocking transitions and fewer repeated keypresses
- The UI no longer depends on three competing interaction systems
- Season and episode selection are consistent and validated
- Failures feel diagnosable and recoverable instead of opaque
- The visual design feels intentional and premium without slowing the app down
