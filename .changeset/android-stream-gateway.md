---
"@kitsunekode/kunai": minor
---

Android handoff now routes headered, cookie, external-subtitle, and deferred-locator streams through a per-playback loopback gateway (127.0.0.1, unguessable token path, normalized headers injected upstream, HLS/DASH URIs rewritten, Range passthrough) — so VLC and mpv-android can play streams that previously failed handoff. yt-dlp-only streams, local files, and non-HTTP schemes still refuse with an explanation.
