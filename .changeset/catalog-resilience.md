---
"@kitsunekode/kunai": patch
---

TMDB access now walks a three-host chain instead of a single fallback.

Every movies/series catalog surface — search, trending, surprise, random,
recommendations, schedules — previously shared one proxy→direct pair. The
videasy proxy has gone NXDOMAIN (upstream wind-down), and the canonical
`api.themoviedb.org` host is intermittently DNS-sinkholed by some ISPs —
measured live: the canonical name resolves to a sinkhole address while
`api.tmdb.org`, the official alias on the same CDN and data, still resolves to
CloudFront. The chain is now proxy → canonical host → alias, with a per-host
circuit breaker (5 minutes) so a dead hop costs one fast failure, not a stall
per request. The breaker only marks availability failures — a transport error
or 5xx advances the chain, a 4xx is a definitive upstream answer identical on
every host and propagates immediately, and a caller abort still marks nothing.

Post-play "more like this" in the anime lane is now anchored to the title that
just ended: AniList's `Media.recommendations` edge supplies genuinely similar
titles instead of generic trending, with trending kept as the fallback for
titles with no recommendations or an upstream miss.

The YouTube `/surprise` tray no longer echoes `/trending` — it draws a random
broad-interest query through Invidious search and falls back to trending only
when search answers nothing.
