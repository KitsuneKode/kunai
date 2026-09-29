---
"@kitsunekode/kunai": patch
---

Harden the debug log and atomic config writes.

`--debug`'s `logs.txt` carried everything the session touched — titles,
providers, paths — at whatever the umask left, typically world-readable. The
file is now created owner-only (0600), an existing permissive log is tightened
on open, and growth is capped at 4 MB with a single `.old` generation kept.

Config and secret writes create their temporary file exclusively with
`O_EXCL`/`O_NOFOLLOW` and retry on collision, so a planted symlink at a
predicted temp name fails instead of being written through, and a colliding
entry is never unlinked.

Shutdown cleanup no longer deletes any `mpvKunaiScriptPath` that happens to
live under the temp dir — only a direct child of the OS temp directory named
`kunai-mpv-keys-*.lua` qualifies.
