---
"@kitsunekode/kunai": patch
---

fix(shell): wire `/image-pane` to the companion-pane toggle and expose queue commands in the root palette

`/image-pane` was registered with an availability gate but had no handler — the
`TOGGLE_COMPANION_PANE` action existed and nothing dispatched it. `/playlist-add`
and `/queue-season` now list in the root overlay palette beside `/up-next`, where
their existing "select a title/episode first" reasons are discoverable instead
of the commands being invisible outside playback.
