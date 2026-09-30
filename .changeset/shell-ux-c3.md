---
"@kitsunekode/kunai": patch
---

Watched downloads now get a real cleanup review instead of a startup log line.

With `autoCleanupWatched` enabled, a cleanup banner appears on `/downloads`
and `/library` when watched downloads are past their grace window, naming the
count and recoverable size. `/cleanup-downloads`
(or `c` on either surface) opens a review picker that shows each candidate with
why it became eligible, asks for explicit confirmation, deletes the artifact,
and reports per-item failures. A low disk space rejection now points at the
same flow. Nothing is deleted silently.

Obsolete settings (`powerSaverAllowManualArtwork`, `autoDownload`,
`autoDownloadNextCount`) are removed from config; legacy files still load and
the retired keys are scrubbed on the next save.

Desktop notifications actually reach the OS now — `notify-send` on Linux,
`osascript` on macOS, a WinRT toast via PowerShell on Windows — gated by
`KUNAI_DESKTOP_NOTIFICATIONS`, deduplicated, and fire-and-forget so a missing
or hung notifier never blocks the shell.
