---
"@kitsunekode/kunai": patch
---

Make the unit suite pass on a fresh machine with no yt-dlp and no assumed DNS.

Stubbed `fetch` no longer trips the stream-target DNS guard, YouTube PO-token
assertions no longer share process-global provider config under `--parallel`,
and download tests refuse to spawn a real yt-dlp. The README now shows the
GitHub Actions CI badge for the ubuntu/macOS/Windows workflow.
