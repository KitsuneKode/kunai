---
status: current
lastReviewed: "2026-09-11"
---

# Provider: AnimeGG

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Request Summary

Find the anime lane a second source that shares nothing with Miruro. On
2026-09-11 anidb.app was in maintenance, AniList's API was disabled, and
AllManga's stream API was behind Cloudflare — leaving Miruro as the only path,
and every one of its backends reachable only through `miruro.bz`.

AnimeGG is that second source. Miruro already reaches it as its `moo` server, so
the content is known-good; this adapter reaches it **directly**, which is the
part that survives a Miruro outage.

## Scope

- **Runtime class:** direct-http, four server-rendered HTML documents. No
  JavaScript step, no crypto, no signed catalog API, no Cloudflare challenge.
- **Module:** `packages/providers/src/animegg/` (`site.ts` parses, `direct.ts` is
  the contract).
- **Catalog identity:** provider-native slugs (`one-piece`, `death-note`).

## Known

Everything here was observed directly on 2026-09-11.

- `GET /search/?q=<query>` returns `<a href="/series/<slug>" class="mse">` blocks
  carrying poster, `<h2>` title, `Episodes: N`, `Alt Titles :`, `Status :`.
- `GET /series/<slug>` lists every episode as `/<slug>-episode-<n>`. One Piece:
  1161 links in a 575 KB document. Naruto: 220. Death Note: 37.
- `GET /<slug>-episode-<n>` carries a `#videos` tab list whose anchors hold
  `data-id` (embed id), `data-mirror` and `data-version` (`subbed` | `dubbed`).
  Naruto ep 1 exposes subbed `25881` and dubbed `25882`; Death Note ep 1 exposes
  `7455` / `7456`. Audio is therefore read from the site, never guessed.
- `GET /embed/<id>` carries `var videoSources = [{file, label, bk, isBk}]`.
  Labels seen: `480p`, `720p`, `1080p`. Some episodes list only `480p`.
- `file` is `/play/<id>/video.mp4?for=<token>`, which 302s to a per-request
  `vidcache.net:8161` URL. The `for` token and the redirect target both change
  per request.
- **The stream requires a referer.** With none, mpv writes no frame; with the
  episode page (or the embed page) as referer it plays. `animegg.org` itself 302s
  either way, so a status check on the `/play` URL cannot see this.
- The subbed version is **hard-subbed** — burned-in English, no separate track.
- No referer, cookie or impersonation is needed for the four HTML documents.

## Unknown

- Whether `for` tokens expire, and after how long. Both a fresh and a 25-minute
  old token still produced a 302, so the cap was not reached in testing.
- Whether the mirror list ever holds anything but `Animegg` — every tab seen so
  far is `data-mirror="Animegg"`.
- Whether the dubbed track is always English (assumed; `data-version` says only
  "dubbed").

## Trap: a probe cannot judge these streams

The `vidcache` host answers `{"error":"Invalid request (bad hand off)"}` with
**HTTP 500** to anything that is not its player — plain GET and ranged GET alike,
fresh URL or stale — while mpv plays the same URL and writes a frame. Any
reachability check over these URLs reports a false death. This is why Miruro's
own backend check excludes plain 500 and cross-host redirects
(`isMiruroBackendDownStatus`).

## Candidate Stream Inventory

One source per episode (the chosen mirror/version), with one stream per listed
quality. `bk` on each source is a backup but not a uniform one: a direct CDN URL
for One Piece, an `mp4upload.com` **embed page** for Naruto. It is parsed out and
ignored — treating them alike would hand mpv an HTML document. A future change
could use it behind one extractor that covers both.

## Subtitle Inventory

None. The subbed version burns them in, so the manifest advertises no
`subtitle-resolve` and streams carry `subtitleDelivery: "hardcoded"` with
`hardSubLanguage: "en"`.

## Sample Cases For Regression

| Case       | Slug          | Episode | Expectation                                               |
| ---------- | ------------- | ------- | --------------------------------------------------------- |
| Sub        | `death-note`  | 5       | resolves, mpv writes a frame (verified: Light at the bus) |
| Dub        | `naruto`      | 2       | picks `data-version="dubbed"`, mpv exit 0                 |
| Search     | `one piece`   | —       | `one-piece` with `Episodes: 1161`                         |
| Foreign id | AniList title | —       | resolve refuses with `unsupported-title`                  |

## Risks And Drift Watchlist

- The `#videos` tab attributes are the whole audio contract; renaming
  `data-version` would silently reduce the provider to whatever tab came first.
- `var videoSources` is matched by shape, not by a parser; a player swap breaks
  extraction and must surface as "no playable file", never as a wrong stream.
- The referer requirement is invisible to every check except a real player.

## Implementation Handoff Notes

Registered in `loadProductionProviderModules()` and second in the default anime
order, behind Miruro. It is the fallback that does not share Miruro's single
point of failure — not a replacement for it: Miruro still has far broader
catalogue coverage through its dozen backends.
