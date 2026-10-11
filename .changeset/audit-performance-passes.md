---
"@kitsunekode/kunai": patch
---

Cut redundant work on the resolve and watchlist paths.

Selecting an AniList-backed discovery title could pay up to five serial provider
searches, and selecting it again paid them all over — titles that map to nothing
now get a short session-scoped negative marker (keyed by provider and language
profile) so reselection is free. An aborted mapping is deliberately not
recorded: a cancelled lookup is not evidence the title has no match.

The source-inventory read now surfaces the row's real creation time, so a
freshly written entry satisfies the stream-health staleness window and skips
the redundant probe it used to be forced through; a stale entry still probes,
and inventory ports that cannot report age keep the previous forced-probe
behavior. The resolve deadline is also created before the cache and inventory
health checks, so those probes share the one caller-visible bound instead of
running outside it.

Miruro's curl HTTP/2 feature probe no longer stalls the event loop with a
synchronous spawn — it runs async, and it probes the resolved curl binary path
rather than whatever `curl` happens to resolve to on PATH. The watchlist picker
reads latest-per-title history once per dialog instead of once per loop
iteration.
