---
status: current
lastReviewed: "2026-09-12"
---

# Provider candidate: Anikoto

> Agent-facing (L3). Never linked from published docs.

## Verdict

**Not worth building now.** The catalog is easy and the stream is not: every
episode is a single third-party embed that refuses a plain fetch. It would be
Kunai's most fragile anime adapter, for coverage KickAssAnime and AnimeGG
already provide as direct media.

Revisit only if the anime lane loses a direct source, or if an `apnshare`
extractor is needed for some other provider anyway.

## What was probed (2026-09-12)

- **Domains rotate.** `anikoto.to`, `anikoto.com` and `anikoto.tv` do not
  resolve; `anikoto.net` answers; `anikoto.org` redirects to **`anikoto.cc`**,
  which is the live one.
- **The site is WordPress** running the **Kiranime** plugin
  (`meta generator: Drupal 11` is decoration — the assets are
  `kiranime-frontend`, `wp-admin/admin-ajax.php`).
- `GET /wp-json/kiranime/v1` enumerates the whole REST surface. The useful
  public routes:
  - `GET /wp-json/kiranime/v1/anime/search?query=<q>` → `{result: "<html>"}`, a
    fragment of `<a href="https://anikoto.cc/anime/<slug>/">` rows with posters
    and titles. Note `query`, not `keyword` — `keyword` answers 400.
  - `POST /wp-json/kiranime/v1/anime/advancedsearch`, `GET /anime/title`,
    `GET /anime/tooltip/<id>`, `GET /episode/scheduled` also exist.
- Episode lists are server-rendered on `/anime/<slug>/` as
  `<a href="https://anikoto.cc/watch/<show>-episode-<n>/">` with titles and
  stills. No JSON needed.
- **The watch page is the wall.** `/watch/<slug>-episode-<n>/` carries exactly
  one player:
  `<iframe src="https://player.apnshare.org/e/<16-hex>">`. No `.m3u8` anywhere
  in the document, no server switcher, no sub/dub toggle, no subtitle tracks.
- That embed answers **403** to a plain `curl` with a Chrome UA and the site
  referer, so extraction needs impersonation on top of an unwritten extractor.

## Why that verdict, concretely

| Wanted                | Anikoto                                            |
| --------------------- | -------------------------------------------------- |
| Direct media          | No — one opaque embed per episode                  |
| Sub and dub           | Not exposed on the page                            |
| Subtitle tracks       | None visible                                       |
| Stable host           | No — four domains tried, two dead, one redirecting |
| Independent of Miruro | Yes, but duplicates coverage already served        |

Compare KickAssAnime, added the same day: catalog JSON, an HLS master in the
clear, nine audio renditions and eight subtitle tracks, no extractor at all.
