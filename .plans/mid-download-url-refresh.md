# Mid-download URL re-resolve on fragment-auth failure

Status: TODO — the one audit-4 download follow-up not already covered by a
plan (048 deterministic disk admission landed; 050 HLS renditions, 056
namespaced ids, 057 reachability, 058 fractional counts all have rows).

## Why this matters

Provider HLS URLs are signed and short-lived. yt-dlp is told to retry
fragments (`DownloadService.ts:1156-1167`: `--retries 10`,
`--fragment-retries 10`, `--retry-sleep 2`) — but retries hit the **same
signed URL**. When the signature expires or the CDN rotates auth mid-download,
every fragment retry returns 403 until the attempt burns out and the job
fails, leaving `.part` orphans. The fix a downloader can't do itself:
re-resolve the episode through the provider lane to mint a **fresh** stream
URL, then resume the same job (`--continue` already set means partial
fragments survive the swap).

## Scope

1. Detect fragment-auth failure: count consecutive 403/401 fragment failures
   in yt-dlp's `--newline` progress output (not just process exit — retries
   currently hide it until exhaustion) and/or the final error class.
2. On auth-failure evidence, kill the yt-dlp process, re-run the provider
   resolve for the job's persisted intent (`resolveIdentity` +
   provider/source/quality selection — the queued-intent persistence in
   `boundary-hardening-and-adaptive-downloads.md` is the contract to reuse),
   swap the URL, restart with `--continue`.
3. Bound the loop: N re-resolves per job (e.g. 2), then fail honestly with
   "URL expired mid-download" rather than a generic fragment error. A job
   that exhausts re-resolves keeps `repairable` status.
4. Test seam: stub yt-dlp output + stub resolve; prove a 403 storm produces
   one re-resolve and a resumed download, not a failed job — and that a dead
   provider fails after the bound.

## Evidence

- `apps/cli/src/services/download/DownloadService.ts:1138-1167` — fragment
  concurrency/retry args; comment already notes flaky-fragment aborts.
- `DownloadService.ts:246` — job `expired` promise exists for admission
  timing; a mid-flight expiry channel is the missing piece.
- Queue intent persistence requirement: `.plans/boundary-hardening-and-adaptive-downloads.md:209,301`.
