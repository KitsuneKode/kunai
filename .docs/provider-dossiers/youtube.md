---
status: current
lastReviewed: "2026-09-29"
---

# Provider: YouTube (`youtube`)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Summary

- **Runtime class:** `mediaKinds: ["video"]` — the video-mode provider, not a
  movie/series adapter. Identity is a YouTube watch URL or ytsearch result.
- **Production module:** `packages/providers/src/youtube/*` (in
  `loadProductionProviderModules()`).
- **Split:** metadata via Invidious/Piped instance pool; playback via
  `youtube.com` watch URLs handed to mpv's `ytdl` hook — Kunai never fetches
  the media bytes itself.
- **`relaySafe: false` + `localOnly: true`, by design:** resolve and playback
  both depend on a local `yt-dlp` binary — `Bun.spawn` in `spawn-ytdlp.ts`.
  Nothing about the lane can run in a serverless relay; declaring it would
  be a lie the relay registry would happily repeat.

## Failure contract

`metadata-failure.ts` classifies yt-dlp's stderr (thrown verbatim by
`fetchYtDlpVideoInfo`) into two buckets:

- **Terminal** — yt-dlp reached YouTube and was refused (unavailable video,
  region-block, removed): playback would fail identically, so the failure is
  non-retryable and honest.
- **Transient** — yt-dlp never got an answer (spawn timeout at
  `spawn-ytdlp.ts`, broken pipe, resolver churn): retryable, because the next
  attempt plausibly succeeds.

`invidious-instance-pool.ts` excludes overlay-network instances (no proxy we
would ever spawn) and marks per-instance failures so a bad instance is not
retried in a loop.

## Why the comparisons stop here

The provider-floor rules that govern the movie/series adapters (cycle engine,
`providerCycleCandidateTimeoutMs`, `shouldStopAfterFailure`, relay upstream
hosts) do not apply: there is no multi-candidate HTTP cycle — one spawn per
probe, one watch URL per playback. Timeout/retry semantics live in the spawn
wrapper, not `runProviderCycle`.

## Known gaps

- No live-recorded session evidence in this dossier — behavior notes are from
  source, not wire captures.
- Playback is delegated to mpv's ytdl hook, so mpv-side yt-dlp freshness is a
  real dependency (a stale youtube-dl-class extractor degrades playback
  without any Kunai-visible signal until the handoff fails).
