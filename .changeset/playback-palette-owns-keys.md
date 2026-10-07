---
"@kitsunekode/kunai": patch
---

Typing into the playback command palette no longer fires playback keys.

Opening the `/` palette during playback and typing a command name ran the playback
keys behind it, one letter at a time: `q` stopped playback, and `n`, `p`, `a` and
`u` skipped, rewound, or toggled autoplay and autoskip. Typing `quit` or `next`
could end the stream before the command ever ran. The palette now owns the
keyboard while it is open, and closing it with Escape hands the keys back.
