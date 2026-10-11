---
"@kitsunekode/kunai": patch
---

Move the shipped lane defaults to providers that answer: VidLink for
movies/series, HiAnime for anime.

Two upstreams the 0.3.0 defaults leaned on have gone dark:

- `api.videasy.to` no longer resolves at DNS (NXDOMAIN, globally — not an ISP
  block). It hosts the provider's TMDB-mirror DB and its legacy non-wings
  endpoints, so a Videasy-led lane loses title-metadata enrichment and part of
  its source inventory. The wings stream endpoints on `api.speedracelight.com`
  still answer, so Videasy stays registered as the lane's last fallback.
- `anidb.app` answers 503 at the origin; ani-cli made the same switch in
  c99221d ("replace anidb with hianime provider", a `fix:`). The AniDB search
  path also used to parse that error page into an empty result list, so an
  outage looked like "no results". `searchAnidb` now reports HTTP status —
  503 surfaces as `AnidbHttpStatusError` instead of `[]`, and a 404 from the
  context fetch is answered inline instead of spending a curl fallback on it.

`providerDefaultsRevision` moves to 2 and the migration now covers both lanes:
a config still carrying a shipped pair (`videasy` + `["rivestream","vidlink"]`,
or `anidb` + its shipped lists, including a `vidking`-era provider id) is moved
to the new defaults once. A reordered list, a non-default pick, or a config
already stamped is left alone, and a user who re-picks Videasy or AniDB
afterwards keeps it.

Videasy stays registered (last in the series lane) so a resurrected domain is a
fallback again; AniDB stays second in the anime lane for its AID cross-link and
XML episode titles. TMDB lookups gain a proxy circuit breaker: after the Videasy
proxy fails once it is skipped for five minutes rather than adding a stalled
DNS/TCP miss in front of every direct call, and a caller abort no longer counts
as evidence the proxy is down.
