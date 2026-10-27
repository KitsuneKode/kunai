---
"@kitsunekode/kunai": patch
---

Reuse attached subtitles when switching languages in Tracks, keeping mpv's
subtitle inventory stable. Native subtitle Off now clears the active selection
without changing the saved language preference, and Off is distinguished from
a hidden selected subtitle.
