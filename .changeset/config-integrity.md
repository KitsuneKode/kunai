---
"@kitsunekode/kunai": patch
---

Fix three config-handling bugs that could ignore a launch flag, clobber another
window's settings, or crash startup on a hand-edited file.

`kunai --offline` now actually puts the session offline. The flag was recorded
but reads of the `offlineMode` setting ignored it, so a supposedly offline run
still checked for binary updates, started sync and analytics, and did provider
network work. `--offline` now makes the run local-only and opens the Library;
the `offlineMode` setting remains the persistent version.

Two Kunai windows no longer fight over `config.json`. A save used to rewrite the
whole file from memory, so an older window could resurrect settings a newer one
had already changed — including re-enabling analytics after you turned it off.
Saves now merge only the keys that window changed, and analytics re-reads the
file before any send so an opt-out in another window is honoured.

A wrong-typed value in `config.json` (for example `"provider": 42`) no longer
crashes startup with a `TypeError`. Values that don't match the expected shape
fall back to their defaults; startup survives a hand-edited file.
