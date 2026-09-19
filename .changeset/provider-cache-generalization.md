---
"@kitsunekode/kunai": patch
---

perf(providers): persist stable provider metadata across sessions (#205)

AniDB external ids (MAL/AniList/official aid + poster) and official episode
metadata now ride `context.cache` instead of dying with the process, and
VidLink's deterministic enc-dec ids persist within their existing 30-minute
TTL. Stream URLs and signed credentials stay memory-only by contract.
