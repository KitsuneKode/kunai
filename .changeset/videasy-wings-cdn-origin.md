---
"@kitsunekode/kunai": patch
---

Fix Videasy playback on the wings CDN family: the playlist host answers 403 to any request carrying an `Origin` header, so streams no longer send one to `*.peakstorm.top` / `*.primecomet.top` hosts. Referer and user-agent are unchanged, as are API calls. Cached candidates expire within the 5-minute stream-manifest TTL.
