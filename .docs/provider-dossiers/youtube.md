---
status: current
lastReviewed: "2026-10-28"
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

Search artwork is normalized before entering catalog rows. Instance-relative
`/vi/` and `/vi_webp/` image paths become canonical HTTPS YouTube CDN URLs;
invalid relative paths fall back to the video-id thumbnail. The catalog poster
resolver also repairs these paths in older cached rows, rather than treating
them as TMDB poster names. Channel artwork requires an absolute HTTPS URL.

Tracks marks the current connection as selected, not as proof of playback.
Resolved subtitle inventory is reported as available; only mpv observations
establish the active subtitle and its visibility.

Direct-ID playback adopts title, poster and video facts from the metadata cache
populated by provider resolve. It performs no second yt-dlp fetch and does not
cache an unrelated catalog's empty `Unknown` answer for video IDs. Matching
`SET_TITLE_DETAIL` updates the session's video facts while retaining known
search fields; the working playback title also adopts the result for history
and sharing. A different video or playlist cannot inherit those facts.

Launch `--quality`, `--audio` and `--sub` choices include the YouTube profile.
Config getters and `getRaw()` expose the same transient values; background
saves retain persisted defaults, and an explicit Settings change clears the
corresponding override. The subtitle preference label says tracks are requested
until mpv supplies selection evidence. None of this establishes sustained media
delivery for a particular client or network.

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
