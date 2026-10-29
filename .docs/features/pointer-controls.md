---
status: current
lastReviewed: "2026-10-29"
---

# Terminal pointer controls

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Browse and Up Next require a prior click on the same selected row before starting
playback, including initially preselected rows. Library clicks select a different
row or open the visibly selected title detail. Tabs navigate immediately. Pointer navigation
never implies deletion, queue clearing, consent, or playback completion.

Tracks and Settings activate the visibly focused choice; keyboard focus can authorize a click. Tracks pass stable
section and value identities from the rendered row/grid cell to the owner. Mouse
and Enter share availability checks and the picker resolution path. A disabled
option provides its reason; it does not resolve a different option. Narrow Tracks
windows follow focus, and source ordering agrees with favorites in every layout.

Settings own semantic row, choice, section, search and scroll events in
`apps/cli/src/app-shell/settings/pointer.ts`. The controller's activation functions
are shared with Enter. Every result follows the same theme preview, persistence,
action and status handling in `SettingsShell.tsx`. Busy actions, text editing and
the command palette disable pointer mutation. An action owns a synchronous lock
until it settles, so multiple clicks or keys before the busy render cannot start
it twice or overwrite its busy state. Section/status rows are not actions.
Clicks on usage analytics only focus the row and explain the Enter requirement;
no mouse path grants keystroke-gated analytics consent or creates an install ID.

Wheel movement focuses the pane beneath the pointer, clamps at its edges and
moves subtitles by the renderer's grid columns, or one row in the narrow stacked
layout. Busy Settings actions also freeze keyboard navigation while retaining
Escape/q cancellation for cancellable actions. It never selects a fallback stream
or changes a setting. Unknown or vanished identities are ignored; selection and
activation are separate transitions. This supplements the existing keyboard path.

These controls depend on the session-owned mouse facade and suspension-aware
registry in `apps/cli/src/app-shell/mouse/`. They require a compatible TTY and
respect `KUNAI_NO_MOUSE=1`. Screen readers, physical terminal emulators, mobile
touch gestures and player-window controls need separate qualification.

## Remaining qualification and scope

The implemented slice covers Browse search/results, Library titles/tabs, Up Next,
Tracks, Settings, setup choices, shared frame footers and command-palette rows. Downloads inside Library release input when covered, but
this does not add click controls to every download action. Calendar, history,
notifications and player-window controls retain their existing input
contracts and need separate pointer work before claiming parity.

Browse home shortcuts also register measured targets. The first click selects;
the second click on the same title/episode/job and mode/provider identity activates through the existing
idle-row action resolver. Keyboard input and overlays clear click authorization;
a different title with the same label cannot inherit it. Browse's footer now
uses its keyboard controller and query submit handler, rather than only
displaying hints. Its command, Enter, navigation, mode, details and other visible
binding actions keep the same guards. Overlays and the local palette remove
underlying targets. This is not a claim that every hint on every screen is a
clickable control; the remaining surfaces above still need their own coverage.

The isolated terminal fixture runs prove routing and persisted state. Physical
Windows/macOS terminal emulators, multiplexers, accessibility and Android touch
are separate acceptance checks. Android detached handoff does not prove playback
completion or watch progress; gateway/native-device qualification belongs to its
own release lane. This terminal UX slice does not qualify live providers.

Provider settings hide YouTube provider selection and fallback order while the
registered YouTube lane has one provider. YouTube mode and its playback settings
remain available. With multiple registered choices, both controls return.
Provider pickers list registered lane providers; reorder screens list the
configured default plus fallbacks, rather than the whole roster. Their footer
advertises selection and movement, while ordinary pickers advertise Enter.
Videasy session credentials still reach the direct resolver; the session-source
labels use the current site name while retaining persisted API identifiers.

## Setup, palette and navigation

Generic list pickers focus a different row on the first click; an already
focused ordinary row can be activated by clicking it. Destructive and
`keyboardOnly` choices only focus on pointer input and require Enter to commit.
The `/analytics` enable row declares `keyboardOnly`, preserving explicit
keystroke consent. Opening the picker's palette unregisters underlying option
targets; confirmation locks out repeated submissions without a delayed callback.

Setup mode, media-profile tabs, audio/subtitle choices and library toggles have
measured targets. Back and footer decisions share the keyboard controller.
Analytics opt-in still requires Enter on the consent screen; pointer confirmation
cannot enable it. The language view and footer fit the supported 72×24 viewport.

Palette rows focus on the first click and activate when already focused. Disabled
rows only explain their reason. Wheel input clamps the highlight; Back closes the
palette and restores the underlying input owner. Downloads also relinquish input
while covered by the palette. Tracks exposes Back; Now Playing exposes Share
through the existing share command. These do not register OS handlers implicitly.

## Shared frame footer controls

Loading, playing and post-play frame footers register only visible live controls.
Left press and release must hit the same stationary action and button. A pressed
control shows a `▾` marker and fill immediately; release, drag, movement or losing
ownership clears the feedback. Idle hover appears only from actual terminal
motion reports. No synthetic hover or feedback timer runs. Locked frames, root
overlays and the local command palette release the footer's measured rectangles.

Commands opens the local frame palette. Loading and playback letters use
`apps/cli/src/app-shell/playback-shell-input.ts` for both pointer and keyboard:
Cancel requires a cancellable resolve, Stop calls the active-player handler,
Tracks requires candidates and a picker, and fallback requires an available
fallback and handler. Missing handlers remove those controls. Cancel and Stop
remain available even on surfaces without a command callback.

Loading and failure expose `/provider` when the current command set contains it.
An enabled command uses the same action as palette Enter. While resolution blocks
provider changes, clicking opens the filtered palette and its disabled reason.
It never forces a provider switch around the command guard. Recovery adds one
Recover footer control when its real handler exists. Existing keyboard bindings
and command aliases remain the fallback on terminals without mouse support.

The type-ahead suggestion band is a bounded, separately filled surface with a
window that follows keyboard selection and a three-line preview of already-loaded
title metadata. Its border, heading and preview are counted in the browse layout
budget. Query history advertises search; title rows advertise opening and details.
This does not add pointer activation to suggestion rows.
