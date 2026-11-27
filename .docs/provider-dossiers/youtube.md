---
status: current
lastReviewed: "2026-11-27"
---

# Provider: YouTube (`youtube`)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Live capability audit (2026-11-27)

**Status: working.** Provider search selected the canonical `Me at the zoo`
upload (`youtube:jNQXAC9IVRw`). Resolution returned 24 yt-dlp formats in
2.02 s, spanning 144p and 240p because that is what the 2005 source video
carries; no higher-quality absence should be inferred from this fixture.
German and English subtitle tracks were exposed.

The watch-page locator is intentionally not probed as an ordinary direct
media URL. Playback proof instead came from the yt-dlp/mpv path, which wrote
a real 320x240 PNG frame. Actual dependencies remain YouTube watch metadata
plus Google-hosted media endpoints selected by yt-dlp; no relay is involved.

## Sweep dependency (2026-11-24)

The November 23 hosted provider sweep had no yt-dlp executable. It reported an
exhausted resolve before making a playback request. The sweep workflow now
installs yt-dlp and Deno before probing. The sweep enables YouTube metadata
extraction and requires at least one video format for a healthy row. A local
probe using the pinned executable discovered 38 video formats for the same
fixture. The first hosted observation with the tools installed is pending.

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

Search artwork is normalized before entering catalog rows. Instance-relative
`/vi/` and `/vi_webp/` image paths become canonical HTTPS YouTube CDN URLs;
invalid relative paths fall back to the video-id thumbnail. The catalog poster
resolver also repairs these paths in older cached rows, rather than treating
them as TMDB poster names. Channel artwork requires an absolute HTTPS URL.

Tracks marks the current connection as selected, not as proof of playback.
Resolved subtitle inventory is reported as available; only mpv observations
establish the active subtitle and its visibility.

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

- The normalized metadata schema is v4: format IDs survive height/codec/FPS/bitrate
  labels. Older normalized schemas refetch rather than inventing exact IDs.
- Connection lanes request the same video with different extractor clients.
  Availability can differ; a format discovered during metadata extraction is not
  proof that all clients support it. Exact selectors fail if unavailable instead
  of silently substituting another video format. Video-only formats use best
  audio; separate audio-language/bitrate choices are not exposed by this ladder.
- SponsorBlock categories are forwarded to yt-dlp/mpv. Forwarding and metadata
  tests do not prove sponsored segments are removed during streaming, and give
  no Premium-equivalent or ad-free playback guarantee.
- Desktop speed uses native mpv bindings, documented in the public shortcuts
  guide. Mobile is the separate terminal entrypoint in `apps/mobile/src/entry.ts`,
  with player handoff rather than a web layout or desktop mpv controls. Physical
  Termux/a-Shell input and VLC playback need device evidence through
  `bun run test:live:mobile-host-proof`; desktop fixtures do not qualify them.

- No live-recorded session evidence in this dossier — behavior notes are from
  source, not wire captures.
- Playback is delegated to mpv's ytdl hook, so mpv-side yt-dlp freshness is a
  real dependency (a stale youtube-dl-class extractor degrades playback
  without any Kunai-visible signal until the handoff fails).
