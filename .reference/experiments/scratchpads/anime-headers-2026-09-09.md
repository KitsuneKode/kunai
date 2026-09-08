# Anime provider headers probe — 2026-09-09

Lab-only. One plain-HTTP request per site; no production code touched.
Background: `.reference/experiments/scratchpads/provider-miruro/` (MIRURO_BACKEND_REPORT.md,
research-brief.md, UNIFIED-RESEARCH-REPORT.md),
`scratchpads/provider-allmanga/episode-metadata-and-latency.md`,
`.docs/provider-dossiers/allanime-parity-history.md`.

## 1. AllAnime (api.mkissa.net) — host alive, gate state unresolved

- Probe: `GET https://api.mkissa.net/` with browser UA + `Referer: https://mkissa.to/`
  → **HTTP 404 `Cannot GET /`** (Express default body, 139 bytes). No Cloudflare
  challenge on plain fetch; the API host is up.
- This single request **cannot** distinguish NEED_CAPTCHA vs empty-sources vs crypto
  failure — that needs a full bootstrap + episode-sources round trip (multi-request,
  over budget). Honest status of each hypothesis:
  - NEED_CAPTCHA-shaped gate remains the leading hypothesis: "catalog loads (11 eps),
    zero links" is exactly the documented 2026-08-13 asymmetry (catalog ungated,
    sources gated). The shift from explicit NEED_CAPTCHA to _silent_ zero suggests
    either the gate response shape changed (empty `data` instead of the NEED_CAPTCHA
    string, slipping past the `AllMangaCaptchaError` branch) or crypto went stale.
  - Crypto rotation (build 140 → ?) is not ruled out: the last rotation announced
    itself as `unknown_build_id`/404 on bootstrap, which from the caller's side also
    looks like zero links if the error branch swallows it.
- Browser runtime changes **nothing** here: AllAnime is pure GraphQL + HMAC/AES crypto,
  no browser gate. The lever is egress IP (user-owned relay in an ungated region),
  not a browser.
- Honest path: **parity work in the lab** — re-run the 2026-08-24 recovery procedure
  (fetch mkissa homepage → crypto chunk → verify `x-aa-boot` → decrypt a real
  `tobeparsed` blob) and log the raw sources-query body to see whether the gate still
  says NEED_CAPTCHA.

## 2. Miruro (miruro.bz pipe) — WAF tightened, plain fetch now 403s

- Probe: `GET https://miruro.bz/api/secure/pipe?e=<episodes/anilistId 21>` with browser
  UA + `Referer: https://miruro.bz/` → **HTTP 403 Cloudflare "Attention Required"**
  (5506 bytes). In June this same shape answered 200 to plain fetch, so the edge
  posture has tightened: the pipe itself is now behind the challenge, not just the
  homepage.
- Browser-runtime question **unconfirmed within budget**: `miruro-headless.ts` exists
  precisely for in-page fetch with CF-cleared cookies, but running it is multi-request
  by nature. Expectation from lab history is that in-page fetch still works (the June
  finding was homepage-Turnstile + open pipe; now it may be homepage-Turnstile + pipe
  needing the same clearance cookie). Unknown, not assumed.
- Honest path: **lab headless run first**; if in-page pipe works, the pipe is metadata
  (obfuscated JSON, not media), so a user-owned relay in an uncleared-egress region is
  a legitimate relay candidate — confirm against the relay metadata-only contract
  before promising it. If headless also 403s, **wait/deprioritize**, don't burn key-
  rotation work on a WAF block (PIPE_KEY rotation would look like garbage-decrypt, not 403).

## 3. anidb.app — still down, nothing to work around

- Probe: `GET https://anidb.app/` with Chrome/150 UA → **HTTP 503 `Under Maintenance`**
  page (4296 bytes, noindex). Origin-side maintenance, not a bot gate.
- Browser runtime changes **nothing**: a 503 maintenance page is served to everyone;
  headless would render the same page.
- Honest path: **wait**. No parity work, no relay work — there is no upstream to be
  par with. Re-probe with a single HEAD later; treat Miruro `pewe` (AniDB-backed HLS
  via Miruro pipe) as equally down while this persists.
