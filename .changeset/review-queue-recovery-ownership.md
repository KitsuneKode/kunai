---
"@kitsunekode/kunai": patch
---

Preserve Up Next priority after reordering, keep claimed items out of the next
playback selection, and dispatch due downloads even behind many deferred jobs.
Keep the playback watchdog active during cache starvation, give the command
palette ownership of playback keys, and cancel the weekly digest dismissal
timer when its shell unmounts.

Limit startup cleanup to compiled Kunai binaries and preserve foreign files
during native uninstall.
