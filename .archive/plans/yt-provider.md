# YouTube Provider Plan

Status: Implemented (v1 + history/continue polish)

Use this when extending or hardening the first-party YouTube provider.

## Architecture (locked)

- **Search/browse:** Invidious primary (`api.invidious.io` instance rotation), Piped fallback
- **Detail/quality:** `yt-dlp -J` on cache miss for formats and subtitles (SQLite cache, 15m TTL)
- **Playback/download:** canonical `youtube.com/watch?v=ID` + mpv `--ytdl-format` (never primary-path googlevideo URLs)

## Implemented scope (v1)

- Third provider lane: `ProviderLane: "youtube"` + shell mode cycle `series → anime → youtube`
- Provider module: `packages/providers/src/youtube/*`
- Shared services: `YtDlpService`, `YouTubeMetadataService`, SQLite `youtube_metadata_cache` (wired on resolve)
- Browse metadata: duration, channel, views, live badge in search rows
- Playback: `resolve()` returns watch URL + `requiresYtdl`; per-quality stream candidates for quality picker
- History/continue: `mediaKind: "video"`, youtube mode restored on resume, legacy `movie:` keys self-heal on upsert
- Collections: `listEpisodes()` for playlists/channels via Invidious
- Downloads: watch URL enqueue with youtube mode fallback + `--write-subs` / `--write-auto-subs`
- Share links: `cat=youtube:VIDEO_ID` + `kind=video` encode/decode round-trip

## Remaining polish

- Settings UI for cookies / extractor args / custom Invidious instance
- Diagnostics panel: yt-dlp version, metadata instance health
- SponsorBlock / chapter autoskip hooks
- Opt-in live smoke: `apps/cli/test/live/youtube-smoke.test.ts`

## Research inputs

- reference repo: `~/Projects/osc/ytfzf`
- binary dependency: `yt-dlp`
- metadata fallback: public Invidious/Piped instances
