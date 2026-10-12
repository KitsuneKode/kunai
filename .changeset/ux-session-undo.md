---
"@kitsunekode/kunai": minor
---

Session undo on `z`: queue adds, list membership changes, follows, and similar
actions journal a reversible entry, and `z` reverts the newest one while a
transient strip says what was undone. Undo is session-local and only covers
actions with a clean inverse.
