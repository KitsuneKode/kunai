# Command Palette Scope

The palette is powerful, but every surface must stay scoped.

## Scope Levels

### PPS Palette

Contextual hub. It can include:

- next/resume/replay
- episodes
- tracks
- recommendations
- search
- calendar
- autoplay/autoskip
- stop after current
- diagnostics when relevant

### Subpanel Palette

Scoped tool menu. It can include:

- commands for that panel
- back/close
- adjacent panel jumps when useful
- disabled commands with useful reasons

It should not show the whole app.

### Global Palette

Available from root/global mode. Includes:

- settings
- diagnostics
- provider
- setup
- docs/about/update
- presence

Exact typed global commands may be supported later, but they should not appear by default in scoped panels.

## Groups

Use groups only when relevant:

- Suggested
- Watch next
- Session
- This panel
- Return
- Diagnostics

## Footer

```text
[tab] complete   [↑↓] choose   [enter] run   [esc] close
```
