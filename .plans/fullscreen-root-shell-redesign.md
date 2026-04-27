# KitsuneSnipe — Fullscreen Root Shell Redesign

Status: In Progress

Last updated: 2026-04-28

This plan defines the target fullscreen TUI architecture for the new runtime. It is the implementation companion to:

- [.plans/persistent-shell-implementation.md](./persistent-shell-implementation.md)
- [.docs/ux-architecture.md](../.docs/ux-architecture.md)
- [.docs/design-system.md](../.docs/design-system.md)

Use this file when changing `src/app-shell/*`, `src/main.ts`, playback shell behavior, browse layout, overlays, or image-pane behavior.

## Objective

Move KitsuneSnipe from a hybrid mounted-shell UI into one connected fullscreen terminal app with:

- one root-owned frame
- one persistent brand/header surface
- one dominant content region
- one consistent footer and command story
- one overlay system
- no scrollback-dependent normal interaction

The shell should feel like a premium fullscreen TUI, not a stack of nested cards.

## Design Defaults

These are the current default decisions unless a later pass intentionally changes them.

### 1. Root owns chrome

Recommended and adopted:

- `AppRoot` owns the outer frame, brand row, top-level status context, and the fullscreen visual shell
- browse, playback, loading, and picker flows become content surfaces inside that frame

Why:

- prevents disconnected branding
- reduces duplicated separators and borders
- keeps the app reading as one terminal product

### 2. Companion pane is conditional

Recommended and adopted:

- preview/details pane appears only on sufficiently wide terminals
- it collapses before the primary task region becomes cramped
- it should never dominate the browse list visually

Why:

- the list and current action are the product
- posters and long summaries are support, not the center of gravity

### 3. Rename later, not during shell migration

Recommended and adopted:

- finish the shell migration first
- rename only after the product shape feels stable

Why:

- changing identity during UI convergence creates noise
- it becomes harder to judge whether the redesign itself is working

### 4. Footer stays per-screen for one migration pass

Recommended and adopted:

- keep current per-screen footer logic during the first flattening pass
- move footer ownership to the root only after content surfaces are flatter

Why:

- avoids bundling too many responsibilities into one risky step
- lets us improve structure before collapsing behavior plumbing

## Product Rules

These are non-negotiable during this migration:

- no duplicated `KitsuneSnipe beta` / future app-name chrome inside child content surfaces
- no normal browse, picker, playback, or settings flow should require terminal scrollback
- `Esc` must mean clear, close, or go back, never implicit confirm
- image support must degrade gracefully without making the layout feel broken
- loading and active playback must stay visually alive, not pale or blank
- command discovery must remain available from anywhere

## Scope

### In scope

- `AppRoot` visual ownership
- browse shell composition
- playback shell composition
- loading shell integration
- overlay and panel layering
- footer hierarchy and task labels
- preview/image-pane sizing and collapse rules
- resize blockers
- command-bar placement and discoverability

### Out of scope for this plan

- provider scraping logic beyond what is needed to support shell states
- subtitle resolver internals beyond visible status and diagnostics hooks
- final rename/brand replacement across docs, package, and binary names

## Visual Direction

The target feel is:

- calm
- cinematic
- terminal-native
- premium
- dense enough to be useful, not cramped

### Surface model

Use one dominant shell frame.

Inside that frame:

1. top bar
2. content region
3. footer strip

Avoid:

- card inside card inside card
- repeated rounded borders for every section
- floating global brand above a separate app panel

### Header model

The header should contain:

- app name / mascot
- current mode/provider context
- compact runtime status

It must stay inside the root frame.

### Content model

Primary content should always come first:

- browse: search + results
- picker: filter + options
- playback: current episode + actions + status
- loading: title + phase + trace

Secondary content should collapse first:

- poster
- long descriptive copy
- explanatory helper copy
- non-critical metadata badges

### Footer model

Footer should:

- orient the user quickly
- prefer task-first phrasing
- avoid dumping every key in one noisy line
- support `minimal` and `detailed` modes

## Layout Spec

### Root frame

Target:

- root frame spans the viewport with light horizontal breathing room
- one rounded border only at the outer shell level
- child shells should not each draw their own full border once migrated

### Browse layout

#### Wide terminals

Use split view:

- left: results and active query
- right: preview companion pane

Target split:

- approximately 68–72% list column
- approximately 28–32% companion column

#### Medium terminals

Use stacked view:

- query and results first
- inline preview summary below selection

#### Small terminals

Use resize blocker if the core interaction can no longer fit legibly.

### Playback layout

Playback shell must show:

- current title and episode identity
- playback state or completion state
- subtitle state
- memory line when enabled
- commands and episode navigation

Poster is optional and should never crowd the text controls.

### Picker layout

Pickers should be content-first:

- title/subtitle
- filter input
- option window
- short orientation line

The current selected item should remain visible without manual scrolling.

## Implementation Slices

### Slice 1: Root-owned frame

Tasks:

- make `AppRoot` own the only fullscreen frame
- move brand into the connected root surface
- subscribe the root to mounted screen changes directly
- stop child content from depending on detached brand chrome

Exit criteria:

- no disconnected logo/header presentation
- root rerenders correctly on screen swaps

### Slice 2: Flatten child shells

Tasks:

- remove redundant full-surface borders from browse, picker, and helper content
- keep local grouping only where it clarifies structure
- reduce repeated separators

Exit criteria:

- the shell reads as one app, not nested cards

### Slice 3: Browse composition redesign

Tasks:

- rebalance list vs companion widths
- strengthen search rail
- reduce badge clutter
- shorten empty and error states
- keep preview text useful when image support is weak

Exit criteria:

- browse feels premium with or without posters
- result list stays dominant

### Slice 4: Playback convergence

Tasks:

- make playback, loading, and post-playback visually continuous
- preserve subtitle status and memory visibility during active playback
- avoid blank intermediate states

Exit criteria:

- active playback never looks dead or disconnected

### Slice 5: Root overlays

Tasks:

- migrate settings, provider, history, diagnostics, season, episode, and subtitle flows toward root overlays
- reduce helper-shell fallback paths

Exit criteria:

- most major workflows no longer feel like separate applications

### Slice 6: Footer and command convergence

Tasks:

- keep task-first footer wording
- reduce cognitive load
- eventually centralize footer ownership if the remaining per-screen logic becomes redundant

Exit criteria:

- command discovery remains high without clutter

## Technical Work List

### `src/app-shell/ink-shell.tsx`

- continue reducing shell-specific outer chrome
- introduce clearer root-frame helpers if needed
- reduce duplicated layout math where possible
- keep image cleanup aligned with shell transitions

### `src/main.ts`

- keep this as the only default runtime entrypoint
- do not reintroduce top-level prompt-era behavior here

### `src/app-shell/image-pane.ts`

- keep Kitty/Ghostty first
- ensure image cleanup is reliable
- keep non-image fallback visually acceptable

### `index.ts`

- legacy only
- no new fullscreen redesign logic should land here

## Testing Requirements

Before closing a major slice:

- `bun run format`
- `bun run typecheck`
- `bun run lint`
- `bun run test:unit`

Add or update:

- layout-policy tests if breakpoint behavior changes
- panel-data tests if diagnostics/help/footer guidance changes
- VHS tapes for meaningful visual shell differences

## Manual Verification Checklist

- browse on wide terminal
- browse on medium terminal
- browse with no poster support
- browse with poster support
- active playback state
- loading state
- post-playback actions
- settings overlay
- diagnostics overlay
- history overlay
- repeated provider/mode switching
- terminal resize during browse and playback

## Acceptance Criteria

This plan is complete when:

- the shell feels like one fullscreen app
- branding is connected to the main shell frame
- nested full-width cards are no longer the default visual pattern
- browse is useful and attractive both with and without images
- active playback remains visually alive
- normal use does not depend on terminal scrollback
- `src/main.ts` owns the new shell path cleanly, without old prompt-era dependencies creeping back in

## Deferred But Important

- final app rename
- mascot/pet animation system
- richer image preview service beyond current Kitty/Ghostty path
- full provider/subtitle diagnostic explorer UI
