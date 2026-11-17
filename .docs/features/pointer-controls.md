---
status: current
lastReviewed: "2026-11-17"
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
respect `KUNAI_NO_MOUSE=1`. Screen readers, physical terminal emulators, and
mobile touch gestures need separate qualification. The mpv window keeps mpv's
own mouse.

## Remaining qualification and scope

The implemented slice covers Browse search/results, the schedule (day chips and
type tabs navigate immediately; a title row selects, then opens), suggestion
rows, Library titles/tabs, Up Next, Tracks, Settings, setup choices, shared
frame footers, command-palette rows, History tabs and rows, Notifications rows,
and download rows. A download click never deletes or aborts: the first click
selects, and the second click plays a finished file or retries a failed one.
The mpv window itself is not a Kunai surface — its mouse stays with mpv.
The header fox (`🦊 Kunai`) and `⌃G` go home. Away from home they remember the
browse view and any open panels, then leave. On the idle home they put that
place back. A root picker (episode list, download confirm, checklist, Stats)
closes on home the same way as post-playback — the mounted session settles with
its cancel fallback. Browse clears its home flag on unmount so a stale “at home”
never blocks home after browse is gone.

During loading or playback the fox uses the same select-then-commit rule as row
clicks: the first click only arms a transient warning; the second fox click or
`⌃G` stops and leaves. Any other key disarms. `⌃G` alone still goes home in one
step. Leaving playback still does not resume the video.

History, notifications and download rows relinquish pointer hits while the
command palette is open, like browse. Wheel scroll on those lists clears the
remembered first-click row, matching downloads.

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
Suggestion rows use the same select-then-commit rule as Enter. The first click
highlights the row. The second click opens a title or runs the saved search.
