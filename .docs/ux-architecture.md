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
- footer for contextual hotkeys
- command bar for global actions
- overlays for secondary flows

### Command philosophy

- `/` is the global entry point for actions
- common operations should have short command aliases
- commands should be discoverable rather than hidden

### Hotkey philosophy

- hotkeys are contextual, not globally modeful
- use direct keys for high-frequency actions only
- do not hijack normal text-entry behavior
- if an action is unavailable, show why instead of silently ignoring the input

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

## Validation And Reliability

- UI actions should dispatch validated commands
- async work should surface clear status changes
- disabled states should be explicit
- recoverable failures should offer direct next steps
- diagnostics should be accessible to users, not hidden behind debug-only knowledge

## Visual And Motion Rules

- polish should support comprehension, not distract from it
- use subtle transitions for overlays, loaders, and status changes
- keep motion interruptible and cheap
- treat Kitty graphics and `chafa` as enhancements, not assumptions
- preserve a strong plain-text fallback path

## Anti-Patterns

- mixing multiple interaction models in the same primary flow
- hidden timed key windows
- blocking setup wizards for common adjustments
- asking for raw values when structured data already exists
- decorative animation that delays interaction
