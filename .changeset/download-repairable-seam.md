---
"@kitsunekode/kunai": patch
---

Stop a repairable download showing up twice in the download manager.

`repairable` was returned by both `listCompleted()` and `listFailed()`, so one
job rendered as two rows sharing an id and index-based selection acted on a
phantom row.

A repairable job is completed work carrying a repair, not a failure:
`markRepairable` sets `progress_percent = 100` and stamps `completed_at`,
because the media downloaded and is playable — only the sidecars need another
pass. So it now lists as completed, and the repair sweep reads a dedicated
`listRepairable()` instead of filtering failures. The three lists are disjoint
by status.

Diagnostics keep the signal: repairable jobs are counted under
`downloadSummary.repairable` and still drive the downloads health row to
`recoverable` with its own wording, rather than being reported as failures.
