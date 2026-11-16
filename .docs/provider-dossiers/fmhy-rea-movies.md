---
status: current
lastReviewed: "2026-11-12"
---

# FMHY starred movie/series sites — backend family vs Kunai

> Agent-facing (L3). **Never linked from published docs.** Parent intake: `.docs/provider-dossiers/fmhy-starred-parity.md` (not edited by this pass).

## Scope and method

- **Question:** Which FMHY-starred movie/series frontends expose a **new** direct-media backend Kunai does not already ship, vs **skins** of `videasy`, `vidlink`, `vidrock`, `rivestream`, or `movy`?
- **Date:** 2026-11-12.
- **REA:** `rea` CLI **not** on PATH; REA MCP **not** connected. No `rea setup` or engine installs. Bundle work is curl + ripgrep on public HTML/JS only.
- **Constraints:** No video segments, no Turnstile/Anubis bypass, no token harvest, no decryptors. Metadata GET/HEAD only where noted.
- **Kunai fingerprint set:** `api.speedracelight.com`, `player.videasy.to`, `vidlink.pro`, `enc-dec.app`, `vidrock.net`, `sub.vdrk.site`, `rivestream.app` / `backend.rivestream.app`, `secretKey`, `backendfetch`, `www.movy.sx`, `api.wecollege.net`, `db.wecollege.net`, OpenSSL `Salted__`.

Labels below separate **observations** (fetched artifacts), **inferences**, and **unknowns** (including REA gaps).

## Family summary

| Family                          | Sites in this pass                      | Kunai overlap                                                                                  | Parity score                                     |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Movy / wecollege**            | `movy.sx` (control)                     | `movy` module                                                                                  | **mirror**                                       |
| **Rivestream**                  | `rivestream.app` (control)              | `rivestream` module                                                                            | **mirror**                                       |
| **P-Stream fork**               | `cinecat.eu`, `basementx.lol` (blocked) | None as a single backend; uses `@p-stream/providers` scrape lane                               | **hold** (plugin mix, not one host)              |
| **Cinrift / 7Movies**           | `7movies.ac`                            | None in bundles                                                                                | **hold** (iframe player, third-party disclaimer) |
| **Flixer.su SPA**               | `flixer.gd`                             | None of the five Kunai backends                                                                | **hold**                                         |
| **Cinejoy SvelteKit**           | `cinejoy.pk`                            | Not seen in captured chunks                                                                    | **unknown**                                      |
| **Cno dedicated API + storage** | `cno.to`                                | **`a.111477.xyz`** not in Kunai tree. Observed on the downloads API, not on a probed media URL | **next dossier**                                 |
| **PressPlay / VidBinge Astro**  | `pressplayz.top`                        | No Kunai hostname match in HTML; `@vidbinge` branding                                          | **hold**                                         |
| **arc018 PHP / ajax**           | `arc018.stream`                         | No Kunai hostname match in homepage                                                            | **hold**                                         |
| **Cloudflare / bot wall**       | `nepu.io`, `popcornmovies.st`           | Bundle not readable                                                                            | **unknown**                                      |
| **Anubis / origin down**        | `flystream.net`, `basementx.lol`        | Bundle not readable                                                                            | **unknown**                                      |

**New backend finding:** Only **Cno** surfaced a host Kunai does not ship (`a.111477.xyz`). The captured response is the downloads API, a folder URL, not a probed m3u8 or mp4. The watch bundle is an HLS player whose stream path is assembled at runtime. Everything else with readable JS either matches a known module, is an aggregator or P-Stream fork, or does not expose Kunai fingerprints.

---

## Dedicated-server stars (FMHY order)

### https://nepu.io/

| Field                | Value                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Final URL            | `https://nepu.io/`                                                                                                         |
| HTTP status          | **403**                                                                                                                    |
| HTML/JS readable     | **No** — Cloudflare managed challenge (`Just a moment...`, `challenges.cloudflare.com`, `/cdn-cgi/challenge-platform/...`) |
| Script URLs          | Challenge loader only (observation: saved `captures/nepu.io.html`, ~5.4 KB)                                                |
| API hosts in bundle  | **Unknown** — application bundle not returned                                                                              |
| Metadata media shape | **Unknown**                                                                                                                |
| Family inference     | **Unknown** (dedicated-server candidate per FMHY; REA gap)                                                                 |
| **Score**            | **unknown**                                                                                                                |

### https://cno.to/

| Field                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final URL               | `https://cno.to/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| HTTP status             | **200**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| HTML/JS readable        | **Yes** — Vite SPA: `captures/cno.to.html` → `/assets/index-Dlb-grVy.js` (**200**, 382 KB); lazy `/assets/Watch-BhwIojoN.js` (**200**, 544 KB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Script URLs             | `https://cno.to/assets/index-Dlb-grVy.js`, `https://cno.to/assets/Watch-BhwIojoN.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| API hosts / path shapes | **Observation:** Same-origin `fetch(\`/api${t}\`, …)`in`Watch-BhwIojoN.js`. Literal paths include `api/trickplay`, `api/subs/file/…`, `api/rooms/…/leave`, `api/downloads/movie/${id}`, `api/downloads/tv/${id}/…`, `api/comments`, `api/votes/…`(from`index-Dlb-grVy.js`). **Observation:** `111477.xyz`string and`111477\.xyz`regex in`index-Dlb-grVy.js`. **No** `speedracelight`, `vidlink`, `wecollege`, `rivestream`, `vidrock`, `Salted__` in bundles (rg counts 0).                                                                                                                                                                    |
| Metadata response       | **Observation:** `GET https://cno.to/api/downloads/movie/550` → **200** `application/json` body `{"source":"a.111477.xyz","folder":"https://a.111477.xyz/movies/Fight%20Club%20(1999)/"}`. **Observation:** `GET https://cno.to/api/downloads/tv/1396/1` → **200** with `a.111477.xyz` folder under `/tvs/Breaking%20Bad/Season%201/`. **Observation:** Wrong paths → **404** `{"error":"Not found"}`. **Observation:** `GET https://cno.to/api/trickplay` without player context → **403** HTML (Cloudflare). **Inference:** Playback uses same-origin `/api…` plus storage on `a.111477.xyz`; watch-page m3u8 URL not captured in this pass. |
| Family inference        | **Dedicated Cno stack** — not a skin of Videasy/VidLink/VidRock/Rivestream/Movy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Score**               | **next dossier** — the only new host in this pass. `GET /api/downloads/movie/550` returns a folder on `a.111477.xyz`. That is a download listing, not a probed stream. `Watch-BhwIojoN.js` is an HLS player (`#EXTINF`, `#EXT-X-TARGETDURATION`) and calls same-origin `/api/trickplay` and `/api/subs/file/…`. The watch URL is built as ``fetch(`/api${t}`)``, so the stream path is still unknown.                                                                                                                                                                                                                                          |

### https://pressplayz.top/

| Field            | Value                                                                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final URL        | `https://pressplayz.top/`                                                                                                                                                                                                                                                                    |
| HTTP status      | **200**                                                                                                                                                                                                                                                                                      |
| HTML/JS readable | **Yes** — Astro 5 homepage `captures/pressplayz.top.html` (~60 KB). Title page `GET /movie/550-fight-club` → **200** (~123 KB).                                                                                                                                                              |
| Script URLs      | `/_astro/page.CBpwmeIr.js` (**200**, 165 B stub), `/_astro/ClientRouter.….js`, `/_astro/Layout.astro_….js` (**200**, 374 B). Movie page references multiple streaming **servers** in copy (observation: FAQ + disclaimer).                                                                   |
| API hosts        | **Observation:** `twitter:site` / `twitter:creator` → `@vidbinge`. **Observation:** No `vidlink`, `videasy`, `wecollege`, `rivestream`, `vidsrc` in movie HTML (rg 0). **Inference:** VidBinge-operated UI; stream URLs likely loaded client-side after pick-server (not in static capture). |
| Metadata media   | **Unknown** — no m3u8/mp4 string on static movie HTML                                                                                                                                                                                                                                        |
| Family inference | **PressPlay / VidBinge** front — **not** a known Kunai backend hostname                                                                                                                                                                                                                      |
| **Score**        | **hold** — multi-server UI without reproducible direct URL in fetched artifacts                                                                                                                                                                                                              |

### https://arc018.stream/

| Field            | Value                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Final URL        | `https://arc018.stream/`                                                                                                                                                                         |
| HTTP status      | **200**                                                                                                                                                                                          |
| HTML/JS readable | **Yes** — server-rendered PHP-style page `captures/arc018.stream.html` (~60 KB). **Not** the same bytes as PressPlay (MD5 differs from `pressplayz.top.html`).                                   |
| Script URLs      | Inline scripts + `WebsiteURL = "https://arc018.stream/"`; paths like `ajax/load-login-modal.php`, `ajax/ajax.php?trailers=…` (observation: homepage script for YouTube **embed** trailers only). |
| API hosts        | Same-origin `arc018.stream/ajax/…` (observation). **No** Kunai backend literals on homepage.                                                                                                     |
| Metadata media   | **Observation:** Trailer flow returns YouTube embed keys, not direct m3u8. Title watch page not fully characterized (sample slug 404).                                                           |
| Family inference | **Custom PHP streaming site** — parallel to PressPlay in FMHY “dedicated server” list, different implementation                                                                                  |
| **Score**        | **hold** — player/stream likely behind ajax + session; no direct media URL in captures                                                                                                           |

---

## P-Stream forks

### https://cinecat.eu/

| Field            | Value                                                                                                                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final URL        | `https://cinecat.eu/`                                                                                                                                                                                                                                                                                                       |
| HTTP status      | **200**                                                                                                                                                                                                                                                                                                                     |
| HTML/JS readable | **Yes** — `devtools-guard.js`, `config.js`, `worker-origin-rewrite.js`                                                                                                                                                                                                                                                      |
| Script URLs      | `https://cinecat.eu/config.js?v=20261025b` (**200**, 1.1 KB)                                                                                                                                                                                                                                                                |
| API hosts        | **Observation:** `window.__CONFIG__.VITE_SOURCES_API_URL = "https://edge.cinecat.eu"`. Worker fleet on `*.2wwlgkfo-31a.workers.dev` for TMDB proxy, discover, party, etc. **Inference:** Same architecture as `xp-technologies-dev/p-stream` (`package.json` depends on `github:xp-technologies-dev/providers#production`). |
| Metadata media   | **Observation:** `GET https://edge.cinecat.eu/` → **404** JSON `not_found` (edge alive, no root catalog). Plugin output shape **unknown** without running source scrapers.                                                                                                                                                  |
| Family inference | **P-Stream fork** — aggregator over `@p-stream/providers`, not a single new Kunai backend                                                                                                                                                                                                                                   |
| **Score**        | **hold**                                                                                                                                                                                                                                                                                                                    |

### https://basementx.lol/

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| Final URL        | `https://basementx.lol/`                                   |
| HTTP status      | **522** (Cloudflare origin timeout)                        |
| HTML/JS readable | **No** (~16 B error body)                                  |
| Family inference | **Unknown** — expected P-Stream fork per FMHY; **REA gap** |
| **Score**        | **unknown**                                                |

### https://github.com/xp-technologies-dev/p-stream (source plugins)

| Field       | Value                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP status | **200** (GitHub API + raw `package.json`)                                                                                                                                                                    |
| Observation | Repo is public; runtime providers come from dependency `@p-stream/providers` → `github:xp-technologies-dev/providers#production`, not from a `plugins/` source list in-tree (`plugins/` only theme tooling). |
| Inference   | Starred forks (Cinecat, Basement, …) share **one** provider package; Kunai parity is “implement compatible scrapers / pick plugins that return probeable URLs”, not “one hostname = one module”.             |
| **Score**   | **hold** (family-level)                                                                                                                                                                                      |

---

## Aggregator samples

### https://cinejoy.pk/

| Field            | Value                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Final URL        | `https://cinejoy.pk/`                                                                            |
| HTTP status      | **200**                                                                                          |
| HTML/JS readable | **Yes** — SvelteKit `/_app/immutable/…` chunks (observation: `app.BG_KW6jq.js` 12 KB downloaded) |
| API hosts        | **Unknown** — no Kunai fingerprint in downloaded chunks (rg 0)                                   |
| **Score**        | **unknown**                                                                                      |

### https://popcornmovies.st/

| Field            | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| Final URL        | `https://popcornmovies.st/`                             |
| HTTP status      | **403**                                                 |
| HTML/JS readable | **No** — Cloudflare challenge (same shape as `nepu.io`) |
| **Score**        | **unknown**                                             |

### https://7movies.ac/

| Field            | Value                                                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final URL        | `https://7movies.ac/`                                                                                                                                                                                                                              |
| HTTP status      | **200**                                                                                                                                                                                                                                            |
| HTML/JS readable | **Yes** — Next.js `data-site="7movies"`; branding strings `cinrift_*` in inline scripts (`captures/7movies.ac.html`, ~306 KB)                                                                                                                      |
| Script URLs      | `/_next/static/chunks/*.js` (samples downloaded; `cinrift` string in chunks `498-…`, `7951-…`)                                                                                                                                                     |
| API hosts        | **Observation:** `preconnect` to `oa.ingangupbelt.com` (ads). Watch route `GET /movie/1792170/watch` → **200**; copy defers **player iframe** mount; footer: content from third-party providers. **No** Kunai backend hostnames in chunks checked. |
| Metadata media   | **Inference:** iframe / third-party lane, not direct m3u8 in HTML                                                                                                                                                                                  |
| Family inference | **Cinrift / 7Movies** custom aggregator skin                                                                                                                                                                                                       |
| **Score**        | **hold**                                                                                                                                                                                                                                           |

### https://flixer.gd/

| Field            | Value                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final URL        | `https://flixer.gd/`                                                                                                                                                                               |
| HTTP status      | **200**                                                                                                                                                                                            |
| HTML/JS readable | **Yes** — `flixer.gd/assets/js/index-93436601.js` (**200**, 509 KB)                                                                                                                                |
| API hosts        | **Observation:** route literals `"/api/progress"`, `"/watch/movie/:tmdbId"`, hostname string `flixer.su`. **Observation:** `https://flixer.su/` → **200**. **No** Kunai backend rg hits in bundle. |
| **Score**        | **hold** — SPA shell; stream host not tied to Kunai roster                                                                                                                                         |

### https://flystream.net/

| Field            | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Final URL        | `https://flystream.net/`                                                                |
| HTTP status      | **200** (challenge page)                                                                |
| HTML/JS readable | **No app** — Anubis “Making sure you're not a bot!” (`/.within.website/x/cmd/anubis/…`) |
| **Score**        | **unknown**                                                                             |

---

## Controls (known backends)

### https://www.movy.sx/

| Field       | Value                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| HTTP status | **200**                                                                                                      |
| Observation | Homepage HTML embeds/config references `https://api.wecollege.net` (string match in `captures/movy.sx.html`) |
| **Score**   | **mirror** (`movy`)                                                                                          |

### https://www.rivestream.app/

| Field       | Value                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP status | **200**                                                                                                                                                    |
| Observation | `_app` chunk contains `backendfetch`, `secretKey`, `https://backend.rivestream.app`, `https://bff.rivestream.app/api/v1` (`captures/js/rivestream-app.js`) |
| **Score**   | **mirror** (`rivestream`)                                                                                                                                  |

---

## Ranked follow-ups (max 3)

1. **Cno (`cno.to`)** — The downloads API is already observed (`a.111477.xyz` folder for TMDB 550 and Breaking Bad S1). The remaining question is the watch resolver: `Watch-BhwIojoN.js` builds ``fetch(`/api${t}`)`` and plays HLS. Capture that path for one movie and one episode, then probe the media URL. Do not treat the download folder as the stream.
2. **NEPU (`nepu.io`)** — Repeat homepage + watch bundle capture when Cloudflare allows (browser session, no challenge bypass automation). Unknown whether it shares Cno/VidBinge or a third stack.
3. **P-Stream provider package** — Enumerate `xp-technologies-dev/providers` entrypoints that return direct URLs vs iframes; wire only plugins that already match a Kunai-capable embed family (see `tmdb-embed-aggregator-research.md`). Prefer this over per-skin dossiers (Cinecat, Flixer, 7Movies).

---

## Artifacts

Captured HTML/JS: `.reference/experiments/scratchpads/provider-fmhy-rea-movies/captures/` (scratchpad; not published docs).
