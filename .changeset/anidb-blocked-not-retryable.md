---
"@kitsunekode/kunai": patch
---

An AniDB Cloudflare block is no longer marked retryable.

`blocked` is only produced after the client's inner Bun/fetch → curl
transports are already spent, so the engine's second attempt could never
succeed — it just cost up to ~24s before fallback was considered. Matches
the `retryable: !captchaBlocked` policy allmanga already states.
