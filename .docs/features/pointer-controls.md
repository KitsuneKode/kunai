---
status: current
lastReviewed: "2026-10-12"
---

# Terminal pointer controls

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Browse, Library and Up Next rows use one click to select and another click on the
visibly selected row to activate. Tabs navigate immediately. Pointer navigation
never implies deletion, queue clearing, consent, or playback completion.

Tracks and Settings use the same focus-before-activation rule. Tracks pass stable
section and value identities from the rendered row/grid cell to the owner. Mouse
and Enter share availability checks and the picker resolution path. A disabled
option provides its reason; it does not resolve a different option. Narrow Tracks
windows follow focus, and source ordering agrees with favorites in every layout.

Settings own semantic row, choice, section, search and scroll events in
`apps/cli/src/app-shell/settings/pointer.ts`. The controller's activation functions
are shared with Enter. Every result follows the same theme preview, persistence,
action and status handling in `SettingsShell.tsx`. Busy actions, text editing and
the command palette disable pointer mutation. Section/status rows are not actions.
Clicks on usage analytics only focus the row and explain the Enter requirement;
no mouse path grants keystroke-gated analytics consent or creates an install ID.

Wheel movement focuses the pane beneath the pointer, clamps at its edges and
moves subtitles by the renderer's grid columns. It never selects a fallback stream
or changes a setting. Unknown or vanished identities are ignored; selection and
activation are separate transitions. This supplements the existing keyboard path.

These controls depend on the session-owned mouse facade and suspension-aware
registry in `apps/cli/src/app-shell/mouse/`. They require a compatible TTY and
respect `KUNAI_NO_MOUSE=1`. Screen readers, physical terminal emulators, mobile
touch gestures and player-window controls need separate qualification.
