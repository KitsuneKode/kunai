---
status: current
lastReviewed: "2026-10-26"
---

# Kunai — UI Redesign Playbook

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this when executing the shell redesign, not when re-deciding it from scratch.

The product direction is already set by:

- [.docs/design-system.md](./design-system.md)
- [.docs/ux-architecture.md](./ux-architecture.md)
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

- prefer Sakura rose/mint semantic accents with amber for caution and red only for actionable errors (see `.docs/design-system.md`)
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

## Kanna on the docs site

The footer uses the small jointed SVG in
`apps/docs/components/brand/kunai-fox-walker.tsx`, with cream tail/chest markings,
offset far paws and a visible eye highlight. `apps/docs/lib/fox-gait.ts` advances
her stride by actual distance, with a short 0.65-width cycle and a six-unit torso
bob. The footer pace is 40 pixels/second; the pointer roamer retains its own pace.
The gait remains pure; React renders state changes, while the rig writes joint
transforms directly without a render per frame.

`apps/docs/components/brand/kunai-fox-patrol.tsx` owns the footer observers and
frame loop. Offscreen or hidden tabs pause it, live reduced-motion changes plant
her feet, and the visible Pause/Resume control stops and resumes her at the same
position. Cleanup removes media/visibility listeners, observers and the pending
frame. The decorative SVG stays outside the accessibility tree; the pause button
has an ordinary keyboard-focusable name and focus outline.

The footer control reads the shared in-memory store in
`apps/docs/lib/kanna-motion.ts`. Pause stops both the patrol and the pointer
roamer, including unprompted chatter. Resume keeps their positions, resets the
frame clock and never overrides reduced motion or a roamer dismissal. The
roamer also cancels its frame while the document is hidden. Navigation within
the app preserves the shared choice; a full reload starts a fresh page session.

`apps/docs/components/layout/footer-wordmark.tsx` is a decorative, oversized
signature below the navigation. Its pointer light uses a local CSS mask,
fine-pointer hover only, and disappears under reduced motion; it never changes
the link layout or accessibility tree. Sibling project links use the curated
website when available, otherwise GitHub, with no category sublabels.

Workshop previews in `apps/docs/lib/workshop.ts` are reviewed local images or
short text introductions, never live iframes, embeds or a screenshot service.
NvChad Themes replaces Arche in the shared list. The Tokyonight editor image
comes from `KitsuneKode/nvchad-themes` commit
`02b23368fd66fc415f056ef5a0a770d3deaabe56`; its palettes credit NvChad/base46.
The run-cli social image comes from `KitsuneKode/run-cli` commit
`60b414d3639a9b115148709d09982037a8a4d882`. Both are resized WebP derivatives,
served locally with reserved aspect ratios and descriptive alternative text.
