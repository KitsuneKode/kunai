---
"@kitsunekode/kunai": patch
---

Confirm destructive Up Next actions and strip terminal escapes from untrusted surfaces.

Pressing `x`, `c`, or `C` in the Up Next queue acted immediately — one keypress
from an accident, next to Ctrl+C, with no status feedback. The first press now
arms (naming the target and count in the status line) and only the second press
mutates, keyed by row id so a resort between presses cannot retarget the
confirm; leaving the queue or pressing any other queue key disarms. Empty
states report honestly instead of silently no-opping.

Provider-controlled text reaching the terminal is now stripped at three more
choke points: playback-failure rows (provider names, titles, failure details),
overlay titles/subtitles (episode-picker subtitles embed the current title),
and `kunai://` handoff descriptions (the search query is shown pre-confirm).
The trailer spawn also terminates mpv option parsing with `--`, matching every
other mpv invocation.

Provider cache bounds: the five AniDB TTL caches and the two AllManga
show/source caches now carry entry ceilings (256/512), so a long session
browsing many titles cannot grow them without bound.
