# Shell And Footer Contract

The shell frame is the shared visual language across playback, browse, pickers, calendar, history, library, and system panels.

## Header

Header grammar:

```text
🦊 Kunai · [Mode] · context · compact facts                     ● status · size
```

Mode chips are reserved for major surfaces:

- Browse
- Search
- Now Playing
- Post-play
- Episodes
- Tracks
- Recommendations
- Calendar
- History
- Library
- Downloads
- Settings
- Diagnostics

Do not chip every fact. Context facts such as provider, title, episode, hardsub, or mode should be plain text unless they are the major mode.

## Body

The body owns the current decision:

- Search: enter query or choose a result.
- Calendar: choose a release.
- Playback: understand current episode and session health.
- Post-play: decide what to do next.
- Tracks: inspect/change stream setup.

Body content should not duplicate footer instructions.

## Footer

Footer grammar:

```text
[key] label   [key] label   [/] commands                         Surface
```

Rules:

- Maximum four visible primary actions plus `[/] commands`.
- Use brackets around keys to avoid run-on command sentences.
- Show repeated actions only.
- Move secondary actions into command palette.
- Collapse secondary footer actions first on smaller terminals.

Examples:

```text
[↑↓] select   [enter] open   [m] similar   [/] commands
[space] pause   [q] stop   [☰ e] episodes   [≋ t] tracks   [/] commands
[tab] type   [←→] day   [enter] open   [shift+enter] details   [/] commands
```

## Footer vs Palette

Footer teaches what the user will repeatedly do on that screen.

Command palette exposes:

- less frequent actions
- scoped commands
- configuration toggles
- diagnostics or global exits where appropriate

## Responsive Rules

Wide:

- Show primary list/content and preview rail.
- Footer can show four actions plus commands.
- Header can show provider, title, episode, and one or two compact facts.

Medium:

- Hide image/poster before hiding text.
- Preview rail may collapse into a toggled details surface.
- Footer drops secondary actions.

Small:

- Header keeps brand, mode, status.
- Body keeps the primary list/input.
- Footer can collapse to `[/] commands` and `[?] help`.

## Flicker And Stability

Stable dimensions are required for:

- shell frame
- footer
- selected rows
- preview rail
- poster/thumb cells
- progress bars
- loading/error/empty states

Dynamic text truncates instead of shifting layout.

## Preview Rail Stability

Preview rails must reserve stable poster/thumb space even while media is loading.

Rules:

- Poster area has a fixed row/column budget for the current terminal size.
- Metadata starts below the reserved poster area, not below the actual rendered image height.
- Loading, missing, failed, and rendered poster states all occupy the same layout slot.
- If image rendering is delayed, show a quiet `Loading poster...` line or placeholder inside the poster slot.
- Do not let title, overview, facts, or action rows jump when the image appears.
- On small terminals, hide the poster slot first and keep metadata stable.
