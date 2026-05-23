# Kunai Sakura Missing Surfaces Implementation Map

This is the redesign work still needed after the S1 Sakura color migration.

S1 made the palette safer by moving deprecated color names toward semantic roles.
It did not redesign the product flow. The next work must improve state handling,
shared primitives, daily surfaces, recovery, and the return loop.

## Are The Current Specs Enough?

Enough for:

- Preventing color drift.
- Keeping title, state, focus, and media-type color rules consistent.
- Defining the first shared primitive boundaries.
- Letting agents avoid obvious file ownership collisions.

Not enough for:

- Starting a full UX redesign implementation without more state contracts.
- Release-grade failure and recovery flows.
- Query versus result-filter search behavior.
- Details sheet behavior for rich metadata.
- Tracks capability normalization.
- Scoped command palette behavior.
- Narrow terminal, poster fallback, CJK, and color fallback behavior.
- The return loop across browse, calendar, history, and post-playback.

## Why The Current Round Was Only Colors

The S1 agent brief intentionally constrained agents to palette consumer
migration. That kept parallel work safe and prevented overlapping edits to
layout, state machines, and shared components.

That was the correct foundation, but it should not be treated as the completed
redesign. Sakura becomes product-grade only when the state and component layers
land.

## What Improves The Feel Beyond Color

1. State contracts:
   Loading, success, empty, error, degraded, resolving, available, countdown,
   and failed states must be explicit.

2. Shared primitives:
   Footer, StateBlock, MediaList, PreviewRail, DetailsSheet, ActionList,
   PickerSurface, CapabilityRows, and CalendarSchedule should own behavior and
   layout.

3. Stable visual rhythm:
   Poster slots reserve space, metadata anchors below posters, footer actions
   collapse predictably, and selected rows keep consistent geometry.

4. Compact context rails:
   Prev/next cards, "now showing", and related tiny context blocks must have
   fixed dimensions, line clamps, thumbnail fallbacks, and low-priority visual
   weight. They should help orientation without competing with the primary
   decision.

5. Scoped interaction:
   Command palettes and pickers should respect the current surface. A modal
   should not become a portal to the whole app unless the user explicitly asks
   for global commands.

6. Useful metadata:
   The UI should show information that helps the user decide what to do next,
   not provider internals unless they explain failure or availability.

## Missing Slices

### S2: Failure And Recovery

Priority: release gate.

Required states:

- Playback did not start.
- Stream stalled.
- No source available.
- Quality variants unavailable.
- Provider degraded and falling back.
- Diagnostics view.

Rules:

- Never mark watched when playback did not start or stalled before meaningful
  progress.
- Never make next episode the primary action after unresolved failure.
- Prefer one recovery action in body and footer.
- Diagnostics are behind a command, not centered in normal flow.
- Degraded fallback can be inline and quiet.

Likely shared units:

- StateBlock.
- ActionList and ActionRow.
- Footer.
- PreviewRail.

### S3: Portability And Stability

Priority: parallel after shared primitives.

Required behaviors:

- Truecolor to 256-color to 16-color fallback.
- Poster image to letter tile to hidden fallback.
- Preview rail collapses before primary list.
- Narrow terminals keep header, main list, primary state, and commands.
- CJK and long-title truncation must preserve column alignment.

Likely shared units:

- ThemeTokens terminal adapter.
- PreviewRail.
- MediaList row measurement.
- Footer collapse logic.

### S4: Search, Tracks, Command Palette

Priority: highest daily-surface work.

Search:

- Separate submitted query from editable input.
- Add result-filter state that filters current results only.
- Preview rail should reserve poster space and avoid layout jump.
- Add DetailsSheet on `shift+enter`.
- Details can include overview, genres, seasons, episodes, trailer link, cast,
  provider availability, and source confidence when available.

Tracks:

- Normalize capabilities before rendering.
- Sections: source, quality, audio, subtitles, hardsub.
- Single-option sections render as facts, not dead pickers.
- Unavailable sections show a reason.
- Failed sections show recovery or fallback action when possible.

Command palette:

- Scope first, global later.
- PPS scope: next, replay, episodes, tracks, search, recommendations.
- Picker scope: open, filter, sort, close.
- Playback issue scope: recover, fallback, sources, diagnostics, stop.
- Global commands appear only through explicit expansion.

Likely shared units:

- MediaList.
- PreviewRail.
- DetailsSheet.
- CapabilityRows.
- PickerSurface.
- ActionList.
- Footer.

### S5: Return Loop

Priority: product stickiness.

Required loop:

- Browse leads with ready-for-you-now releases.
- Calendar shows the same tracked releases.
- History is resume-first.
- Post-playback shows next episode, caught-up state, or recommendations.
- Presence broadcasts useful state when enabled.

Rules:

- Recommendation copy, not generic discovery copy, for post-playback.
- Do not mix completed-show ending with currently-airing caught-up state.
- Calendar must distinguish aired from playable.
- Show countdowns for today.
- Show "new since E5" or equivalent for tracked shows.
- Prev/next context should use compact cards with thumbnails or initials,
  fixed height, and one to two lines of text. Never let long titles stretch the
  rail or overlap the footer.
- Streak copy should be motivating, never guilt-driven.

Likely shared units:

- CalendarSchedule.
- MediaList.
- PreviewRail.
- StateBlock.
- ActionList.

### Compact Prev/Next Context

Priority: required for playback and post-playback polish.

Problem:

- Large text labels like "next" and "prev" feel like debug placeholders.
- Long titles can wrap into clutter and overlap nearby information.
- Tiny thumbnails and missing thumbnails need a designed fallback.
- Prev/next should orient the user, not become the primary content unless the
  selected action is next episode.

Rules:

- Use a fixed-size compact context card: thumbnail or initials on the left,
  title on one line, metadata on one line, state on the right.
- If thumbnail exists, crop it to a stable small rectangle.
- If thumbnail is unavailable, render a two-letter tile.
- Use state glyphs sparingly:
  - `▶` next playable.
  - `✓` watched.
  - `◷` upcoming.
  - `·` muted unavailable/unknown.
- Clamp titles and never increase card height because of long text.
- On narrow terminals, hide prev first, then hide thumbnails, then collapse to
  one text line.

Likely shared unit:

- `ContextCard`.

Suggested view model:

```ts
type ContextCardModel = {
  kind: "next" | "previous" | "now" | "related";
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  thumbnailState: "none" | "loading" | "ready" | "failed";
  stateLabel?: string;
  stateTone?: "success" | "warning" | "muted" | "danger";
  actionLabel?: string;
};
```

## Implementation Order

1. Shared foundation:
   Footer action model, StateBlock, PreviewRail, MediaList, ActionList,
   PickerSurface, CapabilityRows, DetailsSheet, ContextCard.

2. S2 recovery:
   Implement failure and recovery state view models before layout wiring.

3. S4 daily surfaces:
   Search view model, details sheet, tracks capability normalization, scoped
   command palette.

4. S5 return loop:
   Ready-for-you-now, calendar new-since-current, history resume, post-playback
   recommendations.

5. S3 portability:
   Terminal color fallback, poster fallback, narrow layout, CJK/long title
   alignment.

## What To Test

- Reducers and view-model builders for nontrivial state transitions.
- Footer collapse behavior.
- PreviewRail poster loading and fallback states.
- ContextCard with ready thumbnail, missing thumbnail, long title, watched
  previous, and upcoming next states.
- Search query state versus result-filter state.
- Tracks sections for one option, multiple options, unavailable, and failed.
- Calendar state mapping: available, countdown, aired resolving, future, failed.
- Playback failure states do not mark watched or promote next episode.
- Narrow terminal layout keeps primary actions and readable text.

## Visual Reference

See:

- `.design/cli/kunai-missing-surfaces-board.html`
- `.design/cli/kunai-sakura-systems.html`
