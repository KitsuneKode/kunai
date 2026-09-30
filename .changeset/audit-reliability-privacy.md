---
"@kitsunekode/kunai": patch
---

Preserve healthy SQLite databases when startup encounters locks, permissions, or
I/O failures; only recognized corruption errors trigger quarantine and recovery.

Keep episode identifiers in long download filenames and refuse to overwrite or
delete another download's artifact. New downloads use short staging filenames and
exclusive publication; their destination filesystem must support hard links.

Limit the mp4upload TLS compatibility exception to the current file in persistent
mpv sessions, restoring the user's previous TLS setting when playback moves on.
