# KitsuneSnipe — UI Redesign Playbook

Use this when executing the shell redesign, not when re-deciding it from scratch.

The product direction is already set by:

- [.docs/product-prd.md](./product-prd.md)
- [.docs/ux-architecture.md](./ux-architecture.md)
- [.plans/cli-ux-overhaul.md](../.plans/cli-ux-overhaul.md)
- [.plans/persistent-shell-implementation.md](../.plans/persistent-shell-implementation.md)

This file turns those decisions into implementation guidance for real UI passes.

## Design Skills To Apply

When working on terminal UX, use these lenses intentionally:

- `frontend-design`
  Use for full-screen composition, information hierarchy, responsive terminal layouts, and pane balance.
- `emil-design-eng`
  Use for reducing visual clutter, strengthening rhythm, and making dense interfaces feel premium without decoration theater.
- `make-interfaces-feel-better`
  Use for interaction polish, copy clarity, feedback timing, affordances, and state transitions.

These are execution lenses, not reasons to ignore the architecture docs.

## High-Level UI Direction

The shell should feel:

- keyboard-native
- details-first
- responsive and calm
- faster than a prompt chain
- richer than a plain list picker

The shell should not feel:

- like stacked forms
- like a wall of equally weighted text
- like a gimmick-driven terminal dashboard
- like multiple unrelated tools glued together

## Priority Order For Redesign Passes

1. mounted root shell
2. overlay host
3. header, status strip, footer grouping
4. details-first companion pane
5. stronger selected-state styling
6. image support inside the companion pane
7. motion and mascot polish

Do not start with mascot or animation polish before the shell structure is stable.

## Layout Rules

### Wide terminals

- left: searchable navigation list
- right: companion pane
- companion pane owns details and optional image preview

### Medium terminals

- top: navigation list
- bottom: companion pane
- diagnostics and help should overlay rather than split further

### Narrow terminals

- list and input remain primary
- companion pane collapses or becomes a toggled drawer
- image preview collapses before details do

## Information Hierarchy

### Header

Keep short:

- brand
- current mode
- provider
- title/episode context when relevant
- compact readiness or error state

### Main content

- browse results
- picker rows
- playback state
- setup blockers
- diagnostics only when explicitly opened

### Companion pane

Base content:

- title
- type and season/episode facts
- synopsis
- subtitle/provider/quality context
- recommended next action when relevant

Optional enhancement:

- poster or episode still

### Footer

- stable core actions first
- contextual actions second
- wrap cleanly
- never become one unreadable horizontal command sentence

## Visual Rules

- prefer restrained amber/cyan/gray system with green/red only for outcome states
- use badges sparingly and with consistent semantics
- selected rows need a clear active-state marker, not just slightly different text
- empty states and loading states should still feel designed
- avoid repeating the same information in three places unless each repetition serves a different role

## Motion Rules

- selection changes: immediate text response, no animation dependency
- overlays: subtle enter/exit only
- loaders: short, visible, non-blocking
- auto-next / playback return: stateful transition, not a hard jump
- reduced/performance mode must simplify all motion

## Mascot Direction

The fox should be:

- bounded
- state-driven
- occasional
- optional

The fox should not:

- overlap navigation targets
- delay interaction
- animate during rapid list navigation

Implementation path:

1. static identity
2. state-driven ASCII mascot
3. optional richer image/sprite path when supported

ASCII is the baseline fallback. Image/sprite support is enhancement.

## Image Support Direction

For pickers and browse:

- image support belongs in the companion pane
- selection updates text first
- image rendering is debounced and non-blocking
- hide the image before hiding critical text

Use:

- Kitty / Ghostty image protocol when supported
- ASCII/text fallback otherwise

Do not make the shell dependent on image support.

## VHS As UI E2E

Use VHS for:

- visual review of browse shell
- help and diagnostics overlays
- command palette discoverability
- before/after regression capture for redesign passes

Do not use VHS as the only behavioral test.
Pair it with:

- reducer tests
- integration tests
- fixture-driven provider tests

## Definition Of Done For A UI Pass

A UI redesign pass is not done unless it leaves behind:

- updated durable docs when interaction rules changed
- at least one deterministic behavior test seam
- a VHS tape or screenshot path when the change is heavily visual
- no new duplicate interaction models
- no new invisible one-off key behavior
