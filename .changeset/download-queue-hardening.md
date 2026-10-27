---
"@kitsunekode/kunai": patch
---

Keep queued downloads moving past deferred jobs, preserve retry budgets on storage exhaustion, stop workers on shutdown or lost claims, and retain queue failure diagnostics across coalesced passes.

Preserve explicit cancellation when shutdown arrives during a pending storage
probe; releasing an in-memory reservation cannot requeue an aborted job.
