---
"@kitsunekode/kunai": patch
---

A cancelled resolve no longer writes provider health.

`PlaybackResolveService` used to persist `healthDelta`s and title-level
`recordFailure`/`recordCleanSuccess` from whatever attempt state the engine
returned, even when the caller had aborted mid-flight. An attempt that settles
while the abort races can still carry a stale failure delta, so navigating away
during a slow resolve could mark a healthy provider down and poison the next
pick. All three health writes now check `resolveSignal.aborted` first — a
cancel is a decision, not evidence.
