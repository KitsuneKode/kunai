---
status: current
lastReviewed: "2026-11-27"
---

# FMHY Provider Candidate Survey — Movie/TV & Anime Expansion (2026-11-27)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- **Status:** research (shortlist ready for intake; no runtime code changed)
- **Date:** 2026-11-27
- **Goal:** Expand Kunai's Movie/TV lane (currently 5 registered: `vidlink`, `vidrock`, `rivestream`, `movy`, `videasy` — with `videasy` shut down and `movy` CF-403 on hosted egress) and Anime lane (currently 5 registered: `hianime`, `animegg`, `kickassanime`, `miruro`, `allmanga` — with `allmanga` crypto-rotated and `miruro`/`kickassanime` CF-403 on hosted egress) to **8–10 healthy, backend-independent providers per lane**.
- **Sources surveyed:**
  - FMHY Video Index (`https://fmhy.net/videos` / `fmhy/edit` `docs/video.md`, 1,238 lines): Stream Aggregators (12 Superstars 🌟, 15 Stars ⭐, 47 standard), P-Stream Forks, Dedicated-Server, Multi-Server, Anime Streaming (4 Superstars 🌟, 10 Stars ⭐, 42 standard), Cartoon Streaming, and Developer Tools (`Streaming APIs / Embedding / Resolvers`).
  - FMHY Stream Site Grading Wiki (`fmhy/FMHY` `Stream-Site-Grading.md`).
  - Existing Kunai dossiers under `.docs/provider-dossiers/` (`tmdb-embed-aggregator-research.md`, `usage-matrix.md`, `anikai-candidate.md`, `anikoto-candidate.md`, `bitcine.md`, `braflix.md`, `cineby.md`, `cineby-anime.md`, `headless-reverse-engineering-playbook.md`, `cloudflare-bypass-strategy.md`, plus the 10 production provider dossiers) and plans (`.plans/2026-11-25-anitaku-provider.md`, `.plans/2026-11-23-provider-platform.md`).
  - Kunai's provider contract (`packages/providers/src/_template.ts`, `apps/cli/src/container/bootstrap-providers.ts`, `packages/providers/src/vidrock/direct.ts`, `packages/providers/src/kickassanime/direct.ts`).
- **Methodology:** Light, spaced HTTP probes (`curl -4`, Cloudflare DoH fallback via `1.1.1.1/dns-query` for ISP-sinkholed domains, and `curl_cffi` `chrome124`/`chrome131` impersonation) across 42 Movie/TV frontends, 20 standalone TMDB embed APIs, and 30 Anime sites, followed by bundle/API inspection on live responders. No CAPTCHA, Turnstile, or proof-of-work gates were bypassed; signed tokens and API keys are redacted below.

---

## Executive Summary & Quick Wins

1. **Both lanes can reach 8–10 genuinely independent providers without a headless browser.** Every shortlisted provider uses direct HTTP (plain `fetch`/`curl` or Kunai's existing `curl-impersonate` + DoH stack).
2. **Most FMHY "new" sites are frontend skins over ~6 shared embed ecosystems.** Live bundle inspection collapsed dozens of FMHY Superstars/Stars into shared backend families (e.g., `VidQueen`/`VidGold`/`VidMario`/`ArrowTV`/`Cinezo`/`FlikHub` share `punkflix.net` + `*.vidgold.vip`; `Cinecat`/`dulo` share `*.fdbd2956c-edge.workers.dev`; `Hexa`/`Flixer` share `1414.hexa.su` + `cap.hexa.su`; `Anidap`/`AnimeX` share `zaza.animex.one`; `KotoPlay`/`Anisuge`/`KoToTV` share `cdn.anipixcdn.co`).
3. **Three "build this week" S-tier adapters were proven live end-to-end with zero Cloudflare/Turnstile and zero/minimal crypto:**
   - **Movie/TV #1 — VidBolt (`vidbolt.pro`):** Unencrypted JSON `/api/resolve?type=movie&id={tmdb}` returning **4 independent servers** (`orion`, `callisto`, `luna`, `vega`), live-verified HTTP 200 `#EXTM3U`, multi-language audio (**German, English, Spanish, Italian**), multi-language soft subtitles, and `/api/skip` timestamps.
   - **Anime #1 — AniLight (`api.anilight.live` + `satella.buzz`):** Native **AniList ID** lookup, stateless `POST /api/sources/session`, live-verified HTTP 200 JSON for both `sub` and `dub` with multi-language soft subtitles and dedicated `media.satella.buzz` / `subtl.satella.buzz` CDNs.
   - **Anime #2 — Anidap (`chad.anidap.lol` + `graphql.anidap.lol`):** Clean GraphQL + REST JSON aggregator exposing **10 servers** (including 4 backends not in Kunai: `shiro`/`kem.clvd.xyz`, `vee`/`anizone.to`, `neko`/`zaza.animex.one`, `beep`/`24stream.xyz`) with live-verified multi-language VTT soft subs and sub+dub parity.
4. **Bonus operational intel discovered during probing:**
   - **Active Miruro mirror:** FMHY now lists `miruro.cx` (plus `anivault.tv`) alongside the `.bz`/`.ru` hosts in `.docs/provider-dossiers/miruro.md`.
   - **Active Rive mirrors:** FMHY lists `rivestream.ru` and `rivestream.win`.
   - **Free unauthenticated Movie/TV subtitle APIs verified live HTTP 200:** `https://natsuki.hls.lol/subs?tmdbId=550` (4K-synced `.srt` files from the Atlantic/VidOra stack) and `https://sub.vdrk.site/v1/movie/550` (VidRock's sibling `.vtt` service, noted as unwired in `.docs/provider-dossiers/vidrock.md`).

---

## Ranked Shortlist — Movie / TV Lane (Top 6 + 1 Watchlist)

Adding these 6 independent backends to Kunai's active Movie/TV roster (`vidlink`, `vidrock`, `rivestream`, plus `movy` when unblocked) yields **9–10 independent backends**, replacing the permanently shut-down `videasy`.

| Rank             | Candidate (FMHY Frontends)                                                                                                                       | Addressing                                                 | Real Backend / CDN                                                        | Servers                                     | Audio / Dubs                                                     | Max Quality                 | Subtitles                                                  | Container  | Anti-Bot                                                                                      | Difficulty | Browser?                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| **1**            | **VidBolt** (`vidbolt.pro` — powers ⭐ Ghostflix, 🌟 SweetFox)                                                                                   | TMDB ID                                                    | `vidbolt.pro/api/resolve` → `rousav.tech`, `vidbolt.xyz`                  | **4** (`orion`, `callisto`, `luna`, `vega`) | Multi-audio in HLS: **en, de, es, it** (live-verified)           | 1080p (4K tagged in player) | Inline HLS VTT (ar/de/en/es) + `thesubtitledb.org`         | HLS + MP4  | None on API (frame-buster in HTML only)                                                       | **S**      | No                         |
| **2**            | **Atlantic / VidOra** (`atlantic.bz`, `vidora.ac` — FMHY 🌟 Superstar, `fprime.at`, `Atlas`)                                                     | TMDB ID                                                    | `hls.lol` ecosystem (`api.atlantic.bz`, `cdn.hls.lol`, `natsuki.hls.lol`) | Multi-server                                | Multi-audio: **en, hi, es, fr, de, it, ja, ko**                  | **4K (2160p)**              | `natsuki.hls.lol/subs` (`.srt`) + `sub.vdrk.site` (`.vtt`) | HLS        | None (HTTP 200 plain curl); minified Vite JS                                                  | **M**      | No                         |
| **3**            | **VidFast** (`vidfast.vc` / `vidfast.pro` — Multi-Server staple)                                                                                 | TMDB ID                                                    | `vidfast.vc` aggregator (~10–15 named lanes)                              | **10+**                                     | Multi-language on localized lanes                                | **4K (2160p)**              | External VTT/SRT                                           | HLS + MP4  | None (HTTP 200 plain curl); JS/AES `en` payload encryption                                    | **M**      | No                         |
| **4**            | **PunkFlix / VidGold Family** (`player.cinezo.live`, `player.vidgold.net`, `player.vidqueen.st` — powers 🌟 ArrowTV/Cinezo/FlikHub, 🌟 SweetFox) | TMDB ID                                                    | `punkflix.net` / `*.vidgold.vip` / `proxy3.flikhub.net`                   | Multi-server                                | **11 languages**: en, **hi, es, it, fr, de, pt, ar, ja, ko, ru** | **4K (2160p)**              | External OpenSubtitles + provider tracks                   | HLS + DASH | `curl_cffi` 200 on embed; obfuscated bootstrap JS; Turnstile refs in bundle (verify API gate) | **M–L**    | No (verify Turnstile gate) |
| **5**            | **Chillflix** (`chillflix.pw` — powers ⭐ Chillflix, Toflix, Vuflix)                                                                             | TMDB ID                                                    | `chillflix.pw` (`/player-api`, `/api/movie/{id}`)                         | Multi-server                                | Multi-audio: **en, es, fr, de, it, pt**                          | **4K (2160p)**              | External soft subs                                         | HLS        | None (HTTP 200 plain curl); Next.js RSC/API                                                   | **M**      | No                         |
| **6**            | **VidUp** (`vidup.to` — used by 🌟 SweetFox & Multi-Server sites)                                                                                | TMDB ID                                                    | `vidup.to` standalone multi-server embed                                  | Multi-server                                | Multi-language on alt lanes                                      | **4K (2160p)**              | External soft subs                                         | HLS        | None (HTTP 200 plain curl); AES client crypto                                                 | **M**      | No                         |
| **7** _(Alt #6)_ | **MovieBox / Aoneroom** (`movieboxonline.net`, `h5.aoneroom.com` — Dedicated-Server)                                                             | Own search (`subjectId` + `detailPath`; title+year bridge) | `aoneroom.com` / `wefeed-h5-bff` (`istio-envoy`)                          | Single dedicated CDN (`pbcdn.aoneroom.com`) | Huge dub catalog (**en, hi, es, regional**)                      | 1080p                       | Rich multi-lang soft subs                                  | MP4 + HLS  | Zero Cloudflare; ISP-sinkholed locally (needs DoH); web search needs app headers/host RE      | **M**      | No                         |

### Detailed Notes — Movie / TV Shortlist

#### 1. VidBolt (`vidbolt.pro` / `vidbolt.st`) — Recommended First Build

- **Live evidence (2026-11-27):**
  - `GET https://vidbolt.pro/api/resolve?type=movie&id=550` (with `Referer: https://vidbolt.pro/embed/movie/550`) returned HTTP 200 unencrypted JSON.
  - Iterating `?exclude=<seen>` enumerated **4 live servers** on Fight Club (TMDB `550`):
    - `orion` → `img.rousav.tech` (1080p HLS; master playlist probed live HTTP 200 `#EXTM3U` with `Referer: https://vidbolt.pro/`; carries **German, English, Spanish** audio renditions and **Arabic, German, English, European Spanish, Spanish** subtitle tracks).
    - `callisto` → `proxy.vidbolt.xyz` (1080p + 360p MP4).
    - `luna` → `stream.vidbolt.xyz` (720p HLS with **Italian + English** audio).
    - `vega` → `proxy.vidbolt.xyz` (720p + 480p HLS).
  - Dune (TMDB `438631`) and Breaking Bad S01E01 (`type=tv&id=1396&season=1&episode=1` → `gzip.rousav.tech`) both resolved HTTP 200 on first try.
  - Player JS (`/player/p-2T23PXR5.js`, 71 KB) also exposes `/api/episodes?...`, `/api/skip?...`, and `https://api.thesubtitledb.org/v1`.
- **Stability & maintenance:** Low rotation surface (also mirrored at `vidbolt.st` used by Ghostflix). Because `/api/resolve` accepts `?only=<server>` and `?exclude=<csv>`, it maps directly onto Kunai's `runProviderCycle` + `preferredSourceId` contract with zero cryptography.

#### 2. Atlantic / VidOra (`atlantic.bz` / `atlantic.st` / `vidora.ac` / `hls.lol`)

- **Live evidence (2026-11-27):**
  - FMHY 🌟 Superstar (`18/18` grading: 4K, Dual Audio, External Subs). Also powers `fprime.at` and the `Atlas` desktop app (`atlasapp.hls.lol`).
  - `atlantic.bz`, `api.atlantic.bz` (`200 {"message":"Backend is working as expected (v0.1.0)"}`), `vidora.ac/movie/550` (`200`), and `natsuki.hls.lol/subs?tmdbId=550` (`200` JSON with 4K-synced `.srt` URLs) all answer without Cloudflare challenges or Turnstile.
  - `vidora.ac/player/assets/index-CmpWUrOL.js` (1.28 MB) reveals the shared `hls.lol` infrastructure (`cdn.hls.lol` thumbnails, `db.hls.lol/3` TMDB mirror, `natsuki.hls.lol/subs`, `sub.vdrk.site` fallback subs, `api.theintrodb.org/v4` skip markers) and advertises 4K + 8 audio languages (`en`, `hi`, `es`, `fr`, `de`, `it`, `ja`, `ko`).
- **Stability & maintenance:** Active operator with dedicated mirrors (`atlantic.bz` / `atlantic.st` / `fprime.at`) and desktop client. Requires one focused reverse-engineering pass on the minified `vidora.ac` / `atlantic.bz` bundle to capture the exact stream-fetch call before implementation.

#### 3. VidFast (`vidfast.vc`, redirected from `vidfast.pro`)

- **Live evidence (2026-11-27):**
  - `GET https://vidfast.pro/movie/550` cleanly 301-redirects to `https://vidfast.vc/movie/550` → HTTP 200 (216 KB Next.js SSR HTML, zero Cloudflare challenge, zero Turnstile).
  - Page embeds the encrypted `"en"` bootstrap blob used to request its multi-server list and stream endpoints.
- **Stability & maintenance:** One of the most widely embedded independent TMDB backends across FMHY's Multi-Server section, with multi-year uptime and clean TLD rotation. Implementation follows the same pattern as `packages/providers/src/vidrock/` (pure HTTP + ported static decryptor + rotation canary test + hotfix-manifest crypto override).

#### 4. PunkFlix / VidGold Family (`player.cinezo.live`, `player.vidgold.net`, `player.vidqueen.st`, `player.vidmario.net`)

- **Live evidence (2026-11-27):**
  - Bundle fingerprinting proved that **six** FMHY entries share one operator family: `VidQueen` (`q.vidgold.vip`), `VidGold` (`g.vidgold.vip`), `VidMario` (`m.vidgold.vip`), and `ArrowTV` / `Cinezo` / `FlikHub` (`player.cinezo.live` / `proxy3.flikhub.net`), all referencing `punkflix.net` and serving the identical 505,798 B HLS bundle on the VidGold trio.
  - All four embed URLs returned HTTP 200 via `curl_cffi chrome131` (note: `www.cinezo.st` 403'd plain curl but cleared `curl_cffi`).
  - Best non-English dub language breadth found in the Movie/TV survey (11 languages in player manifest; FMHY specifically calls out Spanish & Italian dubs on ArrowTV/Cinezo) plus 4K.
- **Risk / prerequisite:** Player HTML/JS contains Turnstile/Cap references and rotating obfuscated loader filenames (`*-obq1.js`); `api.vidqueen.st/` returned `410` to an unauthenticated bare GET. Confirm during intake RE that the stream endpoint works without interactive Turnstile before coding; build **one** adapter for the family, never multiple.

#### 5. Chillflix (`www.chillflix.pw` — powers ⭐ Chillflix / Toflix / Vuflix)

- **Live evidence (2026-11-27):**
  - `https://www.chillflix.pw/embed/movie/550` returned HTTP 200 (186 KB, no CF, no Turnstile) advertising **4K** and **French, German, Italian, Portuguese, Spanish, English**.
  - Next.js chunks expose `/api/movie/{id}` (live-verified HTTP 200 JSON) and `https://chillflix.pw/player-api`.
- **Stability & maintenance:** Powers three FMHY Star frontends with a unified embed host (`chillflix.pw`). Medium effort to trace the `/player-api` call chain in its Next.js chunks.

#### 6. VidUp (`vidup.to`)

- **Live evidence (2026-11-27):**
  - `https://vidup.to/movie/550` returned HTTP 200 (150 KB Next.js SSR, no CF, no Turnstile), 4K-capable, AES-encrypted API exchange, distinct from VidLink/VidRock/VidFast/VidBolt.
- **Stability & maintenance:** Used as a standalone embed lane on SweetFox and Multi-Server sites. Medium effort (same AES-port + canary pattern as VidRock/VidFast).

#### 7. Watchlist / Alternative #6: MovieBox / Aoneroom (`movieboxonline.net` / `h5.aoneroom.com`) & VixSrc (`vixsrc.to`)

- **MovieBox (`aoneroom.com`):** Completely non-Western mobile-app infrastructure (`istio-envoy`, zero Cloudflare, massive Hindi/Spanish/English dub + soft-sub library). Locally ISP-sinkholed (`movieboxonline.net` required DoH → `206.52.20.227`), and `POST /wefeed-h5-bff/web/subject/search` answered HTTP 200 `{"code":0,"message":"ok"}` with empty `items: []` on `h5.aoneroom.com` and `fmoviesunblocked.net` — indicating region/header/signature gating on the web BFF. High strategic value if a short APK/web-header capture unlocks search+play.
- **VixSrc (`vixsrc.to` / `vixcloud.cc` — powers `StreamingUnity`):** Cleanest dedicated Italian+English dual-audio 1080p/4K HLS embed in the scene, **but** currently returned Cloudflare managed challenge (`403` + `_cf_chl_opt`) even to `curl_cffi chrome124` from this IP. Re-test with `curl_chrome150` or residential egress before investing.

---

## Ranked Shortlist — Anime Lane (Top 6 + 2 Watchlist)

Adding these 6 independent backends to Kunai's existing Anime roster (`hianime`, `animegg`, `kickassanime`, `miruro`, `allmanga`) yields **10–11 providers** with genuine CDN and catalog diversity, eliminating single-host SPOFs (`zokoanime.video` on HiAnime) and Cloudflare-only failure modes (`miruro`, `kickassanime`).

| Rank            | Candidate (FMHY Tier)                                               | Addressing                                                                | Real Backend / CDN                                                                                                                                          | Servers                                                                                       | Audio / Dubs                                                   | Max Quality | Subtitles                                                            | Container        | Anti-Bot                                                                                                             | Difficulty | Browser?              |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **1**           | **AniLight** (`anilight.live` — FMHY ⭐ Star)                       | **Direct AniList ID** (`/api/anime/check-exists?anilistId=`) + own search | `api.anilight.live` + `media.satella.buzz` + `subtl.satella.buzz`                                                                                           | **2** (primary + `backup=true`)                                                               | **Sub + Dub** (both live-verified 200)                         | 1080p       | Multi-lang soft VTT (`tracks[]`: en, ar, …)                          | HLS              | None (stateless `POST /api/sources/session` + light URL decode)                                                      | **S**      | No                    |
| **2**           | **Anidap** (`anidap.lol` — FMHY ⭐ Star; shares proxy w/ ⭐ AnimeX) | GraphQL/REST catalog (`anilistId`/`malId` → slug-5char ID)                | `chad.anidap.lol/rest/api/*` (10 servers; **4 new upstreams**: `shiro`/`kem.clvd.xyz`, `vee`/`anizone.to`, `neko`/`zaza.animex.one`, `beep`/`24stream.xyz`) | **Up to 10** (`yuki`, `sora`, `shiro`, `vee`, `uwu`, `kiwi`, `miku`, `neko`, `mochi`, `beep`) | **Sub + Dub** (`subProviders` + `dubProviders`, live-verified) | 1080p       | Multi-lang soft VTT (live-verified)                                  | HLS + MP4 + DASH | None (HTTP 200 plain JSON on GraphQL & REST)                                                                         | **S**      | No                    |
| **3**           | **AnimeParadise** (`animeparadise.moe`)                             | Own JSON search (`/search?q=`, title+year bridge)                         | `api.animeparadise.moe` (self-hosted catalog/episode API + Next.js watch)                                                                                   | Dedicated                                                                                     | **Sub + Dub**                                                  | 1080p       | Soft subs                                                            | HLS              | None (HTTP 200 plain JSON on `/search`, `/anime`, `/episode`)                                                        | **S–M**    | No                    |
| **4**           | **AniZone** (`anizone.to`)                                          | Own Livewire search (`/anime?search=`, title+year bridge)                 | Self-hosted direct HLS CDN (Vidstack; upstream source scraped by Anidap/NekoWatch)                                                                          | Dedicated (origin host)                                                                       | **Sub only** (Japanese)                                        | 1080p       | Multi-lang soft subs (VTT/ASS)                                       | HLS              | None (HTTP 200 plain curl; Laravel Livewire HTML)                                                                    | **S–M**    | No                    |
| **5**           | **AnimeOnsen** (`animeonsen.xyz`)                                   | Own JSON search (`/v4/search/{q}`, live-verified 200)                     | `api.animeonsen.xyz/v4/` + `cdn.animeonsen.xyz` (original encoder/host)                                                                                     | Dedicated (origin host)                                                                       | **Sub only** (Japanese)                                        | **720p**    | **Native ASS/SSA** (`subtitles-octopus`)                             | **MPEG-DASH**    | None (HTTP 200; guest `Bearer` token required for `/video/{ep}`)                                                     | **M**      | No                    |
| **6**           | **WCO / WatchCartoonOnline** (`wco.tv` — FMHY ⭐ Star)              | Slug search + `/dubbed-anime-list` & `/subbed-anime-list` HTML            | Self-hosted `wco.tv` CDN (`inc/embed` / `getvidlink`)                                                                                                       | Dedicated (origin host, 10+ yr uptime)                                                        | **Massive English Dub** + Sub + Cartoons                       | 720p–1080p  | Hardsub (sub lane) / clean dub                                       | MP4 + HLS        | Zero CF on `wco.tv` w/ DoH (ISP-sinkholed locally); static JS embed decode                                           | **M**      | No                    |
| **7** _(Watch)_ | **AniXo** (`anixo.live` / `anixo.buzz` — FMHY ⭐ Star)              | **Direct AniList ID** (`/embed/ani/{id}/{ep}/{sub\|dub}`)                 | `anixo.buzz` + `anivexaapi-aniko2.hf.space` (`Sora Edge`)                                                                                                   | Multi-server                                                                                  | **Sub + Dub** (both live-verified 200)                         | 1080p       | **9 languages** soft VTT (en, es, es-419, fr, de, it, pt-BR, ru, ar) | HLS              | Embed 200; stream proxy returns `403 Anixo Enterprise Edge Defense` (needs `/api/stream/resolve` or `?t=` decode RE) | **M**      | No                    |
| **8** _(Watch)_ | **AnimePahe Direct** (`animepahe.pw` — FMHY 🌟 Superstar)           | Own JSON `/api?m=search&q=`                                               | Direct `animepahe.pw` → `kwik.cx` / `owocdn.top`                                                                                                            | Dedicated (origin host)                                                                       | **Sub (hardsub) + Dub**                                        | 1080p       | Hardsub only                                                         | HLS              | CF managed challenge (`403` + `_cf_chl_opt`) even w/ `curl_cffi chrome124` from this IP                              | **M**      | No (if TLS/CF clears) |

### Detailed Notes — Anime Shortlist

#### 1. AniLight (`anilight.live` → `api.anilight.live` + `satella.buzz`) — Recommended First Build

- **Live evidence (2026-11-27):**
  - `GET https://api.anilight.live/api/anime/check-exists?anilistId=154587` → `200 {"exists":true,"slug":"sousou-no-frieren"}`.
  - `GET https://api.anilight.live/api/anime/sousou-no-frieren` → `200` JSON carrying `id`, `slug`, `anilistId`, `idMal`, `tmdb`, `episodes`, `subEpisodes`, `dubEpisodes`.
  - `POST https://api.anilight.live/api/sources/session` (empty `{}` body, `Origin`/`Referer: https://anilight.live`) → `200 {"sessionToken":"<redacted>","expiresAt":...}`.
  - `GET https://api.anilight.live/api/sources?slug=sousou-no-frieren&episode=1&language=sub` (and `language=dub`) with `x-source-session: <token>` → **HTTP 200 JSON** containing `tracks[]` (Arabic, English, etc.) and `sources[]` with `<16-char-nonce>.<b64url>` encoded URLs decoded client-side via `IW()` in `assets/index-*.js` and served from `media.satella.buzz` / `subtl.satella.buzz`.
- **Why #1:** Native AniList ID addressing (no fuzzy title matching), zero Cloudflare/Turnstile, both sub & dub with multi-language soft subtitles, dedicated CDN completely independent of all 5 existing Kunai providers, and small implementation effort.

#### 2. Anidap (`anidap.lol` → `chad.anidap.lol` + `graphql.anidap.lol`) — Recommended Second Build

- **Live evidence (2026-11-27):**
  - `GET https://graphql.anidap.lol/api/recent?page=1` and `POST https://graphql.anidap.lol/graphql` (`anime`, `searchAnime`, `catalogAnime`) return HTTP 200 JSON with `id` (slug + 5-char suffix), `anilistId`, and `malId`.
  - `GET https://chad.anidap.lol/rest/api/servers?id=<slug>&epNum=1` → `200` JSON listing `subProviders` and `dubProviders`.
  - `GET https://chad.anidap.lol/rest/api/sources?id=<slug>&epNum=1&type=sub&providerId=sora` → `200` JSON returning direct HLS `sources[]` and multi-language `.vtt` `tracks[]`.
  - Reading `/assets/api-oTmPfobF.js` mapped all 10 provider slots:
    - **4 new upstream backends not in Kunai:** `shiro` (`kem.clvd.xyz` / `hls.dramavideo.se`), `vee` (`anizone.to` / `crs.24stream.xyz`), `neko` (`zaza.animex.one`), `beep` (`bd.aniwatchtv.site` / `playeng.animeapps.top`).
    - **6 resilience/fallback backends:** `sora` (`krussdomi.com` — live-verified HTTP 200 even while `kaa.lt` is CF-403'd!), `yuki` (`megaplay.buzz`), `uwu` (`kwik.cx`), `kiwi` (`anidb.app`), `miku` (`allanime.uns.bio`), `mochi` (`tools.fast4speed.rsvp`).
- **Deduplication note:** `AnimeX (animex.one)` shares the exact proxy hosts (`zaza.animex.one`, `prox.animex.one`); implementing Anidap covers this ecosystem cleanly with a documented REST API.

#### 3. AnimeParadise (`animeparadise.moe` → `api.animeparadise.moe`)

- **Live evidence (2026-11-27):**
  - `GET https://api.animeparadise.moe/search?q=frieren` → `200` JSON (`_id`, `title`, `link`, `episodes`, `genres`).
  - `GET https://api.animeparadise.moe/anime/sousou-no-frieren-season-2` → `200` JSON.
  - `GET https://api.animeparadise.moe/anime/{_id}/episode` → `200` JSON with episode `uid`, `number`, `title`, and 1080p TMDB stills.
  - Zero Cloudflare, zero Turnstile; only the final `/watch/{uid}?origin={_id}` stream fetch needs a brief Next.js bundle trace.

#### 4. AniZone (`anizone.to`)

- **Live evidence (2026-11-27):**
  - Plain `curl` and `curl_cffi` both returned HTTP 200 on `/` (68 KB) and `/anime` (73 KB) with zero Cloudflare challenge and zero Turnstile.
  - Self-hosted Laravel + Livewire + Vidstack origin server — an actual upstream host (Anidap's `vee` server and NekoWatch pull from it) rather than a skin. Strong for clean 1080p soft-subbed releases; sub-only (no dubs).

#### 5. AnimeOnsen (`www.animeonsen.xyz` → `api.animeonsen.xyz/v4/`)

- **Live evidence (2026-11-27):**
  - `GET https://api.animeonsen.xyz/v4/search/frieren` returned HTTP 200 pure JSON (`content_id: "LQf5VCVYgecMGZob"`, `content_title`, `content_title_en`).
  - Watch page uses `dash.js` (MPEG-DASH) + `subtitles-octopus` (native ASS/SSA subtitles) against `/v4/content/{id}/video/{ep}` with an `Authorization: Bearer <token>` header (`/details`, `/episodes`, `/video/1` return `401 Unauthorized` without it).
- **Trade-offs:** Among the oldest and most stable independent anime hosts on FMHY, and native ASS subs are ideal for `mpv`, but capped at **720p** and **sub-only**. Best slotted as a high-reliability independent fallback rather than primary.

#### 6. WCO / WatchCartoonOnline (`www.wco.tv`)

- **Live evidence (2026-11-27):**
  - `www.wco.tv` is ISP-sinkholed on this network but returned **HTTP 200** (65 KB) via DoH (`cloudflare-dns.com`) with zero Cloudflare challenge (`wcostream.tv` returned CF 403, so `wco.tv` should be the primary mirror).
  - Decades-old independent host with unmatched **English Dub + classic anime + cartoon** depth. Free TV episodes use the classic static JS decode to `/inc/embed/getvidlink.php` (some movies/OVAs are paywalled behind `wcopremium.tv`, which the adapter should classify cleanly as `blocked` or `not-found`).

#### 7–8. Watchlist: AniXo (`anixo.buzz`), AnimePahe Direct (`animepahe.pw`), and Anitaku (`anitaku.io`)

- **AniXo (`anixo.buzz`):** Live-verified HTTP 200 embed by AniList ID (`/embed/ani/154587/1/sub` and `/dub`) exposing **9 subtitle languages** (including Spanish, Latin American Spanish, French, German, Italian, Brazilian Portuguese, Russian, Arabic, English). However, direct GET to `anixo.buzz/api/stream/m3u8?t=...` returned `403 Forbidden · Anixo Enterprise Edge Defense` even with Referer, Origin, and `Sec-Fetch-*` headers. Promote to shortlist if a quick RE of `/api/stream/resolve` or `?t=` decoding clears the proxy cleanly.
- **AnimePahe Direct (`animepahe.pw`):** FMHY 🌟 Superstar and the canonical `kwik.cx`/`owocdn.top` origin (decoupling Kunai from Miruro's `kiwi` proxy), but returned CF managed challenge (`403` + `_cf_chl_opt`) even with `curl_cffi chrome124` from this IP. Re-test with `curl_chrome150` before building.
- **Anitaku (`anitaku.io`):** Already scoped in `.plans/2026-11-25-anitaku-provider.md`. Live check confirmed `anitaku.io/browse/` returns HTTP 200 (115 KB), but `/?s=frieren` returned the unfiltered browse page — confirming the plan's note that search RE, rotating gogocdn AES keys, and heavy DMCA domain churn make it lower ROI than AniLight, Anidap, AnimeParadise, AniZone, AnimeOnsen, and WCO.

---

## Backend-Independence Map (Existing 10 + Shortlisted Candidates)

Each row below is a **distinct upstream streaming backend / CDN ecosystem**. Implementing **at most one adapter per row** guarantees zero hidden shared-SPOF redundancy.

### Movie / TV Lane

| Backend Ecosystem                 | Upstream Hosts / CDNs                                                       | Kunai Status                             | FMHY Frontends Sharing This Backend                                        |
| --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| **VidLink**                       | `vidlink.pro`, `enc-dec.app`, `*.hakunaymatata.com`                         | **Existing (active)**                    | SweetFox (lane), Multi-Server sites                                        |
| **VidRock**                       | `vidrock.net`, `cdn*.ngcorp.dad`, `sub.vdrk.site`                           | **Existing (active)**                    | Multi-Server sites                                                         |
| **Rivestream**                    | `rivestream.app`/`.ru`/`.win`, `proxy.valhallastream.com`                   | **Existing (active)**                    | ⭐ Rive, CorsFlix                                                          |
| **Movy**                          | `movy.sx`, `api.wecollege.net` (stillhaven/vidzy/idlix/kinoger)             | **Existing (CF-403 on hosted sweep)**    | 🌟 Movy                                                                    |
| **Videasy / VidKing**             | `api.speedracelight.com`, `player.videasy.to`                               | **Existing (DEAD — shut down Sep 2026)** | Cineby, BitCine, Cineplay, old HDToday                                     |
| **VidBolt**                       | `vidbolt.pro`/`.st`, `rousav.tech`, `vidbolt.xyz`, `thesubtitledb.org`      | **Candidate #1 (S)**                     | ⭐ Ghostflix, 🌟 SweetFox, LE MOVIE (`/api/bolt-self`)                     |
| **Atlantic / VidOra (`hls.lol`)** | `api.atlantic.bz`/`.st`, `vidora.ac`, `cdn.hls.lol`, `natsuki.hls.lol`      | **Candidate #2 (M)**                     | 🌟 Atlantic, fprime, Atlas, 🌟 SweetFox (lane)                             |
| **VidFast**                       | `vidfast.vc` (ex-`.pro`)                                                    | **Candidate #3 (M)**                     | Multi-Server sites (Vidbox, 1Shows, etc.)                                  |
| **PunkFlix / VidGold**            | `punkflix.net`, `*.vidgold.vip`, `player.cinezo.live`, `proxy3.flikhub.net` | **Candidate #4 (M–L)**                   | 🌟 ArrowTV, Cinezo, FlikHub, 🌟 SweetFox (`VidQueen`/`VidGold`/`VidMario`) |
| **Chillflix**                     | `chillflix.pw` (`/player-api`)                                              | **Candidate #5 (M)**                     | ⭐ Chillflix, Toflix, Vuflix                                               |
| **VidUp**                         | `vidup.to`                                                                  | **Candidate #6 (M)**                     | 🌟 SweetFox (lane), Multi-Server sites                                     |
| **MovieBox / Aoneroom**           | `aoneroom.com`, `wefeed-h5-bff`, `pbcdn.aoneroom.com`                       | **Candidate #7 / Watch (M)**             | MovieBox, 123moviesfree, netnaija.film, fmoviesunblocked                   |
| **VixSrc / VixCloud**             | `vixsrc.to`, `vixcloud.cc`                                                  | **Watchlist (CF-gated locally)**         | StreamingUnity (Italian + English dual audio)                              |

### Anime Lane

| Backend Ecosystem             | Upstream Hosts / CDNs                                                                      | Kunai Status                              | FMHY Frontends Sharing This Backend             |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------- |
| **HiAnime (ZokoAnime)**       | `hianime.at` → `zokoanime.video` → `hls*.aniwatchtv.uk`                                    | **Existing (active; single-server SPOF)** | JustAnime (partial), ani-cli v5                 |
| **AnimeGG**                   | `animegg.org` → `vidcache.net:8161`                                                        | **Existing (active; direct MP4)**         | Miruro (`moo`), JustAnime, NekoWatch            |
| **KickAssAnime**              | `kaa.lt` → `krussdomi.com` → `hls.krussdomi.com`                                           | **Existing (CF-403 on hosted sweep)**     | Anidap (`sora`), NekoWatch                      |
| **Miruro**                    | `miruro.bz`/`.ru`/`.cx` → `/api/secure/pipe` (aggregator)                                  | **Existing (CF-403 on hosted sweep)**     | 🌟 Miruro, AniVault, NekoWatch                  |
| **AllManga / AllAnime**       | `api.mkissa.net`, `allanime.day`                                                           | **Existing (stale crypto build 189)**     | ⭐ MKissa, AllManga, Anidap (`miku`), JustAnime |
| **AniLight (`satella.buzz`)** | `api.anilight.live`, `media.satella.buzz`, `subtl.satella.buzz`                            | **Candidate #1 (S)**                      | ⭐ AniLight                                     |
| **Anidap / AnimeX**           | `chad.anidap.lol`, `graphql.anidap.lol`, `zaza.animex.one`, `kem.clvd.xyz`, `24stream.xyz` | **Candidate #2 (S)**                      | ⭐ Anidap, ⭐ AnimeX                            |
| **AnimeParadise**             | `api.animeparadise.moe`                                                                    | **Candidate #3 (S–M)**                    | AnimeParadise                                   |
| **AniZone**                   | `anizone.to` (self-hosted HLS origin)                                                      | **Candidate #4 (S–M)**                    | AniZone, Anidap (`vee`), NekoWatch              |
| **AnimeOnsen**                | `api.animeonsen.xyz/v4/`, `cdn.animeonsen.xyz`                                             | **Candidate #5 (M)**                      | AnimeOnsen, NekoWatch                           |
| **WCO**                       | `wco.tv`, `wcostream.tv` (self-hosted MP4/HLS origin)                                      | **Candidate #6 (M)**                      | ⭐ WCO, WCOStream, WCOForever, WCOFlix          |
| **AniXo (`anixo.buzz`)**      | `anixo.buzz`, `anivexaapi-aniko2.hf.space`                                                 | **Watchlist #7 (proxy 403)**              | ⭐ AniXo                                        |
| **AnimePahe Direct**          | `animepahe.pw` → `kwik.cx` / `owocdn.top`                                                  | **Watchlist #8 (CF-gated locally)**       | 🌟 animepahe, Miruro (`kiwi`), Anidap (`uwu`)   |

---

## Rejected & Deprioritized Candidates (One-Line Reasons)

### Movie / TV Rejected

- **Hexa (`hexa.su`) & Flixer (`flixer.gd`):** Same backend (`1414.hexa.su` / `api.hexa.su`), gated behind `cap.hexa.su/15d2cf0395/` Cap.js proof-of-work CAPTCHA.
- **Cinecat (`cinecat.eu`) & dulo (`dulo.mov`):** Same operator (`*.fdbd2956c-edge.workers.dev` + `analytics.dulo.mov`); edge workers returned HTTP 429 on direct probe.
- **FlyStream (`flystream.net`):** Protected by Anubis (`techaro.lol`) browser proof-of-work anti-bot gate.
- **BingeBang (`bingebang.sx`), Cno (`cno.to`), Vidbox (`vidbox.wtf`):** Cloudflare Turnstile embedded on entry pages.
- **PopcornMovies (`popcornmovies.st`), Way2Movies (`way2movies.vip`), Spacedom (`spacedom.live`), NEPU (`nepu.io`), RidoMovies (`ridomovie.to`), HydraHD (`hydrahd.gd`), MultiEmbed (`multiembed.mov`), SuperEmbed (`streamingnow.mov`):** Hard Cloudflare managed challenge (`403` + `_cf_chl_opt`) even with `curl_cffi chrome124` from this network.
- **Ghostflix (`ghostflix.st`), SweetFox (`sweetfox.st`), ArrowTV (`arrowtv.net`), Cinezo (`cinezo.st`), fprime (`fprime.at`), Toflix (`toflix.co`), Vuflix (`vuflix.co`):** Frontend skins over backends already represented in the shortlist (VidBolt, Atlantic/VidOra, PunkFlix/VidGold, Chillflix, VidUp).
- **LE MOVIE (`lemovie.site`):** Calls `/api/bolt-self/*` (returned HTTP 502 live), 720p cap, redundant with VidBolt.
- **Aether (`aether.st`) & Basement (`basementx.rest`) (P-Stream forks):** `basementx.rest` unreachable; `aether.st` backend (`backend.raccoonunbutteredbagel.zip`) returns CF 403 and P-Stream relies on browser extensions for core sources.
- **Mapple (`mapple.fun` / `mapple.uk`):** Clears CF via `curl_cffi`, but session endpoint (`/api/ui/session`) rejected GET (405) behind opaque Next.js chunks; lower ROI than VidBolt/Atlantic/VidFast/Chillflix.
- **Vumeto (`vumeto.live`):** Wraps `megaplay.buzz` (dead 410 per `.docs/provider-dossiers/hianime.md`) plus `aniembed.se`.
- **Nontongo (`nontongo.win`):** Multi-hop Next.js iframe wrapper (`stream/movie_upcloud/view1.php`) with decoy YouTube iframe and no direct stream JSON.
- **CineLite (`cinelite.xyz`), AniCine (`anicine.sbs`), Primeshows (`primeshows.org`), 1Shows (`1shows.org`), VidSrc.cc, VidSrc.xyz, VidSrc.icu, AutoEmbed, Embed.su, MoviesAPI, VidPlus, Vidify, CinemaOS:** Connection-dead, timeout, or redirected to dead hosts even via DoH on 2026-11-27.
- **VidZee (`player.vidzee.wtf`), VidNest (`vidnest.fun`), VidCore (`vidcore.io` / Reelix), VidSrc.wtf (`viduki.net`), 7Movies (`7movies.ws`), ShuttleTV (`shuttletv.pk`), Cinejoy (`cinejoy.pk`), Vivarium (`vivarium.st`), ZXCSTREAM (`zxcstream.com`), MeowTV (`meowtv.ru`), moanatv (`lfmx.app`), arc018 (`arc018.stream`), PressPlay (`pressplayz.top`):** Opaque SPA shells or dead/404 legacy API paths (`vidrift.net` 404, `shuttletv.pk/movie/550` 404, `vidzee`/`vidnest` API 404); lower ROI than the live-verified shortlist.
- **Previously investigated & still rejected:** Videasy/VidKing/Cineby/BitCine (operator shutdown Sep 2026), VidAPI/`vaplayer.ru`/`vidsrc.pm` (API 404), `2embed.cc` (browser-only obfuscated iframe chain), Braflix & RGShows (dead).

### Anime Rejected

- **JustAnime (`justanime.to`):** Wraps `zokoanime`, `megaplay`, `animegg`, and `allmanga` — zero backend independence from Kunai's existing 5 anime providers.
- **NekoWatch (`nekowatch.xyz`):** Aggregator over `reanime`, `miruro`, `animegg`, `anikoto`, `mkissa`, `anizone`, `animeonsen`, and `kickassanime` — duplicates Kunai's roster plus our direct shortlist.
- **AnimeX (`animex.one`):** Shares `zaza.animex.one` / `prox.animex.one` infrastructure with Anidap (shortlist #2), which already exposes a cleaner REST+GraphQL contract.
- **KotoPlay (`kotoplay.to`), Anisuge (`animesuge.cz`), KoToTV (`kototv.to`), Anikoto (`anikoto.cc`):** Share `cdn.anipixcdn.co` and rely on `megaplay.buzz` (dead 410), `apnshare.org` (403, already rejected in `.docs/provider-dossiers/anikoto-candidate.md`), and Turnstile (`kotoplay.to`).
- **Gotaku (`gotaku.to`), AniDream (`anidream.to`), WeebTube (`weebtube.cc`), AnimeNexus (`anime.nexus`), UniqueStream (`anime.uniquestream.net`):** Cloudflare Turnstile embedded on frontends (`api.anime.nexus` also returned `413 Access Denied`; `UniqueStream` requires DoH and its `/api/v1/series` returned 404).
- **Anistream (`anistream.one`):** Frontend over `hianime` + `animekai` + Supabase — no independent stream backend.
- **Kuroko (`kuroko.cc`):** Frontend skin referencing `Re:ANIME` (`reanime.cz`).
- **AnimeKai (`animekai.to` / `anikai.to`) & HiAnime Official (`hianime.to`):** Connection-dead even via DoH on 2026-11-27 (`anikai-candidate.md` also flagged CF + packed JS + hardsub-only).
- **Anitaku (`anitaku.io`):** Live 200 on `/browse/`, but search markup is non-trivial (`/?s=frieren` returned unfiltered browse HTML), gogocdn AES keys rotate, and DMCA domain churn is the highest in the scene (per `.plans/2026-11-25-anitaku-provider.md`); defer behind the 6 cleaner shortlisted candidates.
- **Re:ANIME (`reanime.cz`), Ani.pm (`ani.pm`), YumeZone (`yumezone.live`), Anify (`anify.to`), Zanix (`zanix.tr`):** Opaque SPA shells without open stream APIs observed in static bundles; lower ROI than AniLight/Anidap/AnimeParadise/AniZone/AnimeOnsen/WCO.

---

## Recommended Implementation Order

1. **Wave 1 (Fastest Wins — Difficulty S, live-verified end-to-end):**
   - **Movie/TV:** `vidbolt` (4 independent servers, multi-audio en/de/es/it, inline soft subs, skip timestamps).
   - **Anime:** `anilight` (AniList-native, sub+dub, multi-lang soft subs, dedicated `satella.buzz` CDN) and `anidap` (10 servers incl. 4 new backends + unblocked `krussdomi.com` fallback).
   - **Bonus quick win:** Wire `sub.vdrk.site` and/or `natsuki.hls.lol/subs` as optional subtitle fallback sources in Movie/TV, and add `miruro.cx` to Miruro's mirror list.
2. **Wave 2 (4K & Multi-Audio Depth — Difficulty S–M to M):**
   - **Movie/TV:** `atlantic` / `vidora` (`hls.lol`, 4K + 8 audio languages incl. Hindi/Spanish/Japanese) and `vidfast` (4K, 10+ servers, AES-port + canary).
   - **Anime:** `animeparadise` (clean JSON catalog, sub+dub) and `anizone` (origin 1080p HLS + multi-lang soft subs).
3. **Wave 3 (Catalog Breadth & Origin Redundancy — Difficulty M to M–L):**
   - **Movie/TV:** `chillflix` (4K + European multi-audio), `vidup` (4K AES), and one adapter for the `punkflix`/`vidgold`/`cinezo` family (if stream API proves Turnstile-free) or `moviebox`/`aoneroom` (for Hindi/regional dub depth).
   - **Anime:** `animeonsen` (stable DASH + native ASS fallback) and `wco` (classic English dub depth via DoH).
