# TMDB-Embed Aggregator Backends — Research Dossier

- **Status:** research (not implemented; multiple candidate providers identified)
- **Date:** 2026-06-05
- **Research goal:** map the browserless paths through the public aggregator backends
  that vidsrc.pm / 2embed.cc / cineby.zip front-end into. Determine if any are
  viable as a new provider module.
- **Scope of this dossier:** the API surface of the backends, the consumer network
  that uses them, and the constraints we'd hit if we added a provider module on
  top of them.
- **Research scripts:** `apps/experiments/scratchpads/vidapi-research/` (the
  probes that produced the data in this dossier).

## Validation Note — 2026-06-05

Follow-up validation from the Kunai provider-quality matrix kept this dossier in
`research` status:

- The VidAPI recipe still works for the known-good Dune movie case
  (`tmdb=438631&type=movie`) via normal `curl` with a Chrome user-agent and
  `brightpathsignals.com` Referer.
- The same API returns provider-level `{"status_code":404}` for
  `Bad Guys` / TMDB `61700` / S01E04, while Kunai's current `vidlink` and
  `rivestream` providers resolve that episode quickly.
- The API response now exposes `thumbnails_url` for the Dune case, which is
  useful seek-bar artwork evidence and should be captured if a provider module
  is ever implemented.
- `default_subs` was empty in the validated Dune response, so this candidate
  still should not be presented as a subtitle-complete primary lane.

Decision: do not promote VidAPI into the default movie/series path yet. Treat it
as a candidate rescue provider only after a broader matrix proves catalog
coverage, subtitle fallback behavior, and long-running URL stability.

## Request Summary

- Provider candidates surfaced: **VidAPI** (the `vaplayer.ru` / `brightpathsignals` /
  `streamdata.vaplayer.ru` stack) and **2embed** (the `2embed.cc` / `2embed.skin` /
  `streamsrcs.2embed.cc` stack).
- Both are **TMDB-indexed movie + TV + anime aggregators** that wrap HLS streams from
  rotating CDN domains.
- Both have **publicly documented APIs** in addition to the iframe chain.
- Both embed third-party CDN URLs whose rotation, devtool-detection, and frame-busting
  make the iframe UX hostile to scraping but the underlying JSON API is reachable.

## Inputs Supplied By Developer

- Initial context: the existing `vidking/direct.ts` path was working with a session
  token, and the question was whether to add a new provider, harden the existing one,
  or take a different approach.
- The user said: _"we are doing research now not really doing weird things here we
  need to research on this"_ — i.e. the goal is to understand the landscape, not to
  ship a scraper today.
- Specific leads to probe:
  - `https://cineby.zip/movie/2aww0-poldi` (confirmed: cineby.zip is a VidAPI consumer)
  - The other "site generator" SaaS consumers of these backends

## Scope

- Content types:
  - movie: yes (90,733 TMDB titles in VidAPI catalog)
  - series: yes (494,820 episode entries in VidAPI catalog)
  - anime: yes (mixed into the TMDB catalog; not separated)
- Features probed:
  - multi-source inventory: yes (4 `stream_urls` per title = 4 quality variants on
    rotating CDN domains, NOT 4 separate sources)
  - subtitles: **no in this API path** — `externalSub.file` is always `""`; real
    subtitle path is `ds_lang` parameter triggering OpenSubtitles auto-search
    (which is itself gated behind a 302 redirect from the OpenSubtitles old REST API)
  - quality variants: yes (SD 640x256 / 720p 1280x512 / 1080p 1920x768 typical;
    bitrate ~661k/2191k/3652k for Dune)
  - dub / audio variants: no in this API path (single audio track per stream)

## Known (Evidence-Backed)

### The two backend ecosystems

**1. VidAPI** (the `vaplayer.ru` / `brightpathsignals` / `streamdata.vaplayer.ru` stack)

- Documented commercial product at `https://vidapi.ru/api` — 46KB of public API docs
  with full endpoint reference, parameter table, and example URLs.
- Canonical public endpoint: `https://vaplayer.ru/embed/movie/{id}` and
  `https://vaplayer.ru/embed/tv/{id}/{season}/{episode}` (also accepts query string
  variant: `?imdb=tt…` or `?tmdb=…&season=…&episode=…`).
- A separate video upload SaaS (also branded "PlayBox") lives at the root of
  `vaplayer.ru` and is unrelated to the embed service.
- Login dashboard at `https://vdash.app/login.php?redirect=%2F` (registration-gated).
- Confirmed free tier works with just a Referer; **paid tier with API keys** is
  documented but not tested in this research.

**2. 2embed** (the `2embed.cc` / `2embed.skin` / `streamsrcs.2embed.cc` stack)

- Different operator from VidAPI. Not a VidAPI consumer.
- Public entry point: `https://2embed.cc/embed/movie?imdb=tt…` (8.7KB page).
- Iframe chain: 2embed.cc → (iframe) → streamsrcs.2embed.cc → (obfuscated runtime
  from `oxidesearching.com` with a randomized path) → ???
- The 2embed player loads `<iframe data-src="https://streamsrcs.2embed.cc/vsrcc?imdb=…">`.
- The actual stream is loaded by obfuscated JS that we could not extract from static
  HTML. The `vsrcc.js` script on the streamsrcs domain and the random-path script
  on `oxidesearching.com` both look like Dean Edwards–style packed JS or comparable
  obfuscation that requires execution to resolve.
- **2embed does NOT have a JSON API path** — it requires a real browser to follow
  the iframe chain. This dossier's recipe is for VidAPI only.

### The VidAPI recipe (works, browserless)

Two endpoints form the complete chain. Both require only an HTTP client with
TLS-fingerprint impersonation (curl_cffi `chrome120` or equivalent):

```
Step 1: GET https://streamdata.vaplayer.ru/api.php?tmdb={id}&type=movie
                    [&season=…&episode=…]
        Headers: User-Agent (Chrome 120),
                 Referer: https://brightpathsignals.com/embed/movie/{id}
        → JSON { status_code, data: { title, imdb_id, file_name, backdrop,
                                      stream_urls: [4 HLS master m3u8 URLs] } }

Step 2: GET stream_urls[0]  (the master m3u8, served on a rotating CDN domain)
        Headers: User-Agent, Referer: https://brightpathsignals.com/embed/movie/{id}
        → application/vnd.apple.mpegurl master playlist with 3 quality variants
        mpv handles the rest of the HLS chain automatically
```

Confirmed working with:

- Movies (Dune, Oppenheimer, Inception, The Matrix)
- TV (Severance S1E1, Severance S2E1)
- Anime (Attack on Titan S1E1, Cowboy Bebop S1E1, Breaking Bad S1E1)
- Both `?tmdb=` and `?imdb=` query keys
- The Referer does NOT have to be the exact URL — the `?imdb=tt15239678` query
  string variant also works, and just `https://brightpathsignals.com/` works.
- **The Referer MUST be on `brightpathsignals.com` exactly** (no `www.` prefix).
  No other domain works (tested: vidsrc._, videasy._, 2embed.\*, vaplayer.ru root,
  streamdata.vaplayer.ru root, justhd.tv, nicheauthorityengine.site, google,
  example.com, no Referer — all 404).
- **The playToken is decorative.** Tested with a valid 64-hex token, an all-zeros
  token, and no token at all: identical responses in all cases.
- **The `id` parameter is NOT accepted.** Tested: `?id=…` returns 400 with
  `{"error":"Missing imdb or tmdb parameter"}`. Must be `?tmdb=` or `?imdb=`.
- IMDB→TMDB mapping is automatic; the API returns the correct title even if you
  supply the wrong one (e.g. `tt15239678` resolves to "Dune: Part Two 2024",
  `tt1160419` is the actual Dune Part One IMDB).

### Confirmed VidAPI consumers (sites that front-end into the VidAPI embed)

- **vidsrc.pm** — the most popular (71KB player page; `hostDomain: "vidsrc.pm"`).
- **vaplayer.ru** — the canonical VidAPI itself.
- **cineby.zip** — confirmed via `cineby.zip/embed/movie/tt15239678` returning
  71,704B (same shape as the vidsrc.pm page) and a `vidapi.ru` reference in the
  SPA. **Note:** the `/movie/2aww0-poldi` URL the user mentioned is a YouTube
  slug for the cineby.zip SPA — it's not a TMDB/IMDB id. The path
  `/movie/2aww0` returns the same YouTube iframe.

### Mirror network: most "vidsrc.\*" domains are dead

Tested 32 vidsrc.\* mirrors. Reality:

- **vidsrc.pm** — only working VidAPI consumer mirror with the full player
- **vidsrc.sbs** — 24.9KB page titled "VidSrc – Movies and TV Seriees API no ADS"
  but **not a VidAPI consumer**; has no `streamDataApiUrl` and no iframes
- **vidsrc.su, vidsrc.fyi, vidsrc.online, vidsrc.wtf, vidsrc.click, vidsrc.lat,
  vidsrc.dev** — all 404 or empty placeholder pages
- **vidsrc.to, vidsrc.cc, vidsrc.in, vidsrc.io, vidsrc.bz, vidsrc.me** — SSL errors
  (orphaned certs, connection resets)
- **20+ others** — DNS NXDOMAIN, including all the "vidsrc.tv/.yt/.fun/.ink"
  variants from the Astralchemist list

The "20 mirrors" framing that vidsrc.ts / streamvix / Inside4ndroid use is
mostly aspirational. \*\*The VidAPI consumer network is small in practice: vidsrc.pm

- cineby.zip + their own vaplayer.ru.\*\*

### 2embed partner / sponsor links (dead)

The 2embed.cc player body has a "Servers" link to `https://cineby.hair/` and a
download form posting to `https://dlhub.cc/search`. Both checked:

- **cineby.hair** — 1.1KB parked page, no player
- **dlhub.cc** — 20KB search form, no public JSON API; internal form action is
  `/details_tz.php?id=`

These are dead affiliate links, not real services.

### Rate-limit and abuse detection

- 200 rapid requests in 24.8s with no delay → 200/200 OK
- 50 requests with 100ms delay → 50/50 OK
- 5/5 different titles in parallel → 5/5 OK
- **No `x-ratelimit-*` headers** in any response
- **No 429 throttle observed** in this burst test
- Long-running stability was NOT tested (would need a multi-hour or multi-day probe)

The lack of rate limiting is consistent with the embed business model: VidAPI
expects to receive one request per video view from real browsers, and their
abuse mitigation is on the iframe page (frame-buster, devtool detection) rather
than the API endpoint.

### Catalog endpoints (full TMDB mirror)

`https://vidapi.ru/ids/movie_list_tmdb.txt` — 90,733 lines, ~600KB, one TMDB id
per line (e.g. `2`, `3`, `5`, …).

`https://vidapi.ru/ids/eps_list_tmdb.txt` — 494,820 lines, ~4.9MB, format is
`<showId>_<season>x<episode>` (e.g. `4_1x1`, `324298_2x9`).

`https://vidapi.ru/movies/latest/page-{N}.json` and
`https://vidapi.ru/episodes/latest/page-{N}.json` — paginated JSON catalogs of
recently added titles (24 per page). Each item includes a full embed URL like
`https://vaplayer.ru/embed/movie/tt1517268` plus metadata.

These would power a "browse all" / "trending" / "what's new" feature, with the
same legal/business exposure as direct API access.

### vidsrc.sbs: a different provider, not VidAPI

`https://vidsrc.sbs/embed/movie/438631` returns 24,901B with title
_"VidSrc – Movies and TV Seriees API no ADS"_. Has no `streamDataApiUrl` in
CONFIG, no iframe chain visible. Uses a different backend entirely. Not
characterized further in this dossier.

## Suspected (Needs Confirmation)

- The `streamDataApiUrl` endpoint might rate-limit by IP after a much higher
  threshold (1000+, not 200) — not tested.
- The 4 `stream_urls` CDN domains (`nicheauthorityengine.site`,
  `visionaryfounderslab.site`, `nextlevelbrandstudio.site`,
  `personalbrandgrowth.site`, etc.) are probably a partner CDN network; the
  domain rotation per title suggests load-balancing. The brand name "CDN" is
  aspirational — the domains have phishing-style names. Worth investigating
  where the actual segments resolve to (not done in this research).
- The `availableSources: ['justhd']` in CONFIG might expand to more sources
  for paid-tier or specific IP ranges — not tested.
- `vidsrc.sbs` might be a VidAPI rebrand from a previous era (title says
  "VidSrc" but no VidAPI integration in the page) — not investigated.
- The "12 algorithms" in vidsrc.ts (the cool-dev-guy TypeScript project) are
  likely the obfuscation patterns needed to reverse-engineer the 2embed and
  similar stacks. Not directly relevant for VidAPI (which has no obfuscation)
  but useful context for the broader space.

## Unknown

- The `ds_lang` OpenSubtitles subtitle path: documented in the VidAPI docs but
  our direct test of `https://rest.opensubtitles.org/search/...` returned 302
  redirects. The OpenSubtitles legacy REST endpoint may be deprecated; the
  VidAPI documentation might be stale.
- The vidsrc.sbs backend: not characterized.
- Whether VidAPI detects and blocks scrapers at the IP level (we did 200
  requests without issue, but a serious scrape might trigger CF bot score on
  the iframe page that we never hit).
- Whether the 4 CDN domains serve legitimate video or inject ads / tracking
  / malware — we never fetched a segment.
- Whether there's a long-tail quality issue (90,733 movies in the catalog
  doesn't mean all of them play; some might be 404'd on the stream side).
- Anime coverage beyond Attack on Titan / Cowboy Bebop / Breaking Bad.
- Geographic restrictions (tested from one IP only).
- VidAPI's terms of service (not fetched). Whether they explicitly prohibit
  scraping is the legal pivot.
- The full set of VidAPI consumers. We only checked a few candidates. The
  Inside4ndroid project's provider list might have more that we haven't probed.

## User Flow

The VidAPI UX is a 2-hop iframe chain:

```
User clicks play on vidsrc.pm
  ↓
vidsrc.pm/embed/movie/438631
  ↓
<iframe src="https://brightpathsignals.com/embed/movie/438631">
  ↓
brightpathsignals.com boots the player.min.js (186KB), issues CONFIG with
streamDataApiUrl, calls streamdata.vaplayer.ru/api.php, gets back 4 stream URLs,
loads one of them into an <video> tag, m3u8 HLS chain takes over
  ↓
mpv or browser plays
```

For our CLI:

```
bun run dev -- -i 438631 -t movie
  ↓
[if vidsrc provider module is wired]
  ↓
CLI hits streamdata.vaplayer.ru/api.php directly (no iframe, no browser)
  ↓
gets 4 stream URLs, picks the highest bandwidth variant
  ↓
hands m3u8 to mpv via the existing apps/cli/src/mpv.ts pipeline
  ↓
mpv plays
```

## URL Patterns

| Pattern                                                                            | Status               | Notes                                 |
| ---------------------------------------------------------------------------------- | -------------------- | ------------------------------------- |
| `https://vidsrc.pm/embed/movie/{tmdb}`                                             | Turnstile-gated      | The public-facing page                |
| `https://brightpathsignals.com/embed/movie/{tmdb}`                                 | Public, no challenge | Player shell                          |
| `https://brightpathsignals.com/embed/tv/{tmdb}/{s}/{e}`                            | Public               | TV player                             |
| `https://vaplayer.ru/embed/movie/{id}`                                             | Public, documented   | VidAPI canonical                      |
| `https://vaplayer.ru/embed/movie?imdb={ttid}`                                      | Public, documented   | Alt query string                      |
| `https://vaplayer.ru/embed/tv?tmdb={id}&season=1&episode=1`                        | Public, documented   | Alt query string                      |
| `https://streamdata.vaplayer.ru/api.php?tmdb={id}&type=movie[&season=&episode=]`   | **The actual API**   | Needs `brightpathsignals.com` Referer |
| `https://streamdata.vaplayer.ru/api.php?imdb={ttid}&type=movie[&season=&episode=]` | Same                 | IMDB variant                          |
| `https://vidapi.ru/api`                                                            | Public               | The full API documentation (46KB)     |
| `https://vidapi.ru/ids/movie_list_tmdb.txt`                                        | Public               | 90K movie TMDB ids                    |
| `https://vidapi.ru/ids/eps_list_tmdb.txt`                                          | Public               | 494K episode ids                      |
| `https://vidapi.ru/movies/latest/page-{N}.json`                                    | Public               | Paginated "what's new"                |

## DOM And Interaction Notes

- **No DOM interaction needed.** The API path is pure HTTP. No clicks, no waiting
  for iframe to load, no JS execution.
- The VidAPI consumer SPAs (vidsrc.pm, cineby.zip) require JS to render, but
  we don't hit those — we go straight to the API.

## Network Findings

- **streamdata.vaplayer.ru** is the only API endpoint we need.
- Endpoint validation:
  - Rejects non-`brightpathsignals.com` Referers with 404 (empty body).
  - Rejects `?id=` parameter with 400 (`{"error":"Missing imdb or tmdb parameter"}`).
  - Rejects `?tmdb=` or `?imdb=` without `playToken` field — wait, no, the playToken
    is decorative. Without it: 200, full data. Tested.
  - Accepts `?tmdb=`, `?imdb=`, both work.
- Response shape (movie example):
  ```json
  {
    "status_code": "200",
    "data": {
      "title": "Dune 2021",
      "imdb_id": "tt1160419",
      "file_name": "Dune (2021) [1080p] [WEBRip] [5.1] [YTS.MX]/Dune.2021.1080p.WEBRip.x264.AAC5.1-[YTS.MX].mp4",
      "backdrop": "https://image.tmdb.org/t/p/w1280/zRKQW58MBEY078AxkHxEJzUskCl.jpg",
      "stream_urls": [
        "https://nicheauthorityengine.site/.../index.m3u8",
        "https://nicheauthorityengine.site/.../index.m3u8",
        "https://nicheauthorityengine.site/.../index.m3u8",
        "https://tmstrd.justhd.tv/cdnstr/H4sI..."
      ]
    }
  }
  ```
- The 4 `stream_urls` are 4 quality variants (SD, 720p, 1080p, and the brand
  CDN variant) on rotating CDN domains.
- Master m3u8 returns `application/vnd.apple.mpegurl` with 3 variant qualities
  (e.g. 661k/2191k/3652k bps for Dune).
- Segment URLs relative to master path; mpv handles the resolution.
- No `cf-mitigated` header in any response — Cloudflare is in front but
  not challenging.
- `x-powered-by`, `x-ratelimit-*` — absent.
- CDN domains themselves are behind Cloudflare (cf-ray headers present on
  segment hosts).

## Embed / Iframe Chain (VidAPI)

1. `vidsrc.pm/embed/movie/{id}` — Cloudflare Turnstile–gated user-facing page
2. → `<iframe src="https://brightpathsignals.com/embed/movie/{id}">` — frame-buster
   check, devtool detection, but **no Turnstile**
3. → `https://streamdata.vaplayer.ru/api.php?tmdb=…` — public JSON API
4. → rotating CDN domain — public HLS m3u8
5. → mpv plays

For our use, **we skip steps 1–2 and go directly to step 3.** The iframe chain
is purely cosmetic for the legitimate embed UX; it doesn't gate the data.

## Candidate Stream Inventory

For "Dune (2021)" / TMDB 438631:

| Candidate      | Source host               | Quality            | Audio | Subs | Evidence  | Notes                    |
| -------------- | ------------------------- | ------------------ | ----- | ---- | --------- | ------------------------ |
| stream_urls[0] | nicheauthorityengine.site | 640x256, 661kbps   | eng   | none | curl_cffi | SD variant               |
| stream_urls[1] | nicheauthorityengine.site | 1280x512, 2191kbps | eng   | none | curl_cffi | 720p variant             |
| stream_urls[2] | nicheauthorityengine.site | 1920x768, 3652kbps | eng   | none | curl_cffi | 1080p variant            |
| stream_urls[3] | tmstrd.justhd.tv          | unknown            | eng   | none | curl_cffi | Brand CDN, b64-gzip path |

The 4 entries are the same content at different bitrates, not 4 separate sources.
Higher-bandwidth is generally better; the brand CDN sometimes has different audio.

## Subtitle Inventory

| Track  | Language | Format | Source | Notes                                                               |
| ------ | -------- | ------ | ------ | ------------------------------------------------------------------- |
| (none) | —        | —      | —      | The CONFIG `externalSub.file` is always `""` for the tested titles. |

The VidAPI docs describe a `ds_lang` parameter that triggers OpenSubtitles
auto-search. The legacy `rest.opensubtitles.org` REST endpoint returned 302
redirects in our test (likely requires API key for the new OpenSubtitles v1 API).
**This is a real gap** — a vidsrc provider module would not have subtitle
support out of the box.

## Headers / Referer / Cookies

- **Referer requirements:** `https://brightpathsignals.com/embed/{type}/{id}`
  is the canonical Referer. Also works: `https://brightpathsignals.com/`
  (root). Does NOT work: any other domain, `https://www.brightpathsignals.com/...`,
  no Referer, `vidsrc.*` domains, `vaplayer.ru` root.
- **Header requirements:** `User-Agent: <recent Chrome on Linux>` is enough
  to pass CF TLS fingerprinting. curl_cffi `impersonate="chrome120"` works.
- **Cookies:** None needed. No session cookie is sent or required. The
  `streamembed_session` cookie set by brightpathsignals.com is irrelevant to
  the API call.
- **No CF clearance / `cf_clearance` needed.** The API endpoint is behind CF
  but does not challenge requests with the right headers.
- **No anti-bot / proof-of-work** on the API. The iframe page has sandbox
  detection (frame-buster, devtool detection, localStorage probe, Blob URL
  probe) but the API does not.

## Runtime Contract Recommendation

If the project wants a VidAPI provider module, the shape would be:

- **Provider kind:** `api-direct` (matches the existing `vidking/direct.ts` pattern)
- **isAnimeProvider:** `false` (the catalog mixes anime into movies/TV; the
  existing project's anime detection via MAL lookup is independent of provider)
- **What should be extracted:**
  - `stream_urls[0..2]` (the 3 quality variants on rotating CDN domains)
  - Master m3u8 URL, handed to mpv via `--referrer`
  - `title` and `imdb_id` for display / cross-reference
- **What should be deferred:**
  - Brand CDN variant (stream_urls[3]) — requires base64-gzip decode of the
    path, the project doesn't need it
  - Subtitles — not supported in this API; the project would need a separate
    OpenSubtitles integration
  - The VidAPI paid tier / API keys — out of scope for "free ad-supported"
  - The 2embed stack — requires browser execution, separate research arc
- **Diagnostics needed:**
  - Log the resolved m3u8 URL with quality + CDN host
  - Detect the `{"error":"Missing imdb or tmdb parameter"}` 400 response
    (signal that the Referer is wrong)
  - Detect the 404 Referer rejection (signal the IP might be flagged)
  - Periodic probe of the catalog endpoint to detect upstream drift

## Sample Cases For Regression

- Movie: Dune (2021) / TMDB 438631 — confirmed working, all 3 quality variants
- Movie: Oppenheimer (2023) / TMDB 872585 — confirmed, hosted on `visionaryfounderslab.site`
- Movie: Inception (2010) / TMDB 27205 — confirmed
- Movie: The Matrix (1999) / TMDB 603 — confirmed
- Series: Severance S1E1 / TMDB 95396 / S01E01 — confirmed
- Series: Severance S2E1 / TMDB 95396 / S02E01 — confirmed
- Anime: Attack on Titan S1E1 / TMDB 1429 / S01E01 — confirmed
- IMDB: Dune Part Two (tt15239678) — confirmed (note: returns "Dune: Part Two 2024"
  not the 2021 Dune, because tt15239678 is actually Part Two)
- Edge case: Arcane S2E1 / TMDB 115036 / S02E01 — returned 19B (empty / error)
  in the catalog, suggesting the API doesn't have every title. Needs retry /
  catalog probe logic to distinguish "API doesn't have it" from "request
  was malformed."

## Risks And Drift Watchlist

- **VidAPI's terms of service are unverified.** Probing their ToS at
  `vidapi.ru/terms` returned 404 in our test. The legal exposure of scraping
  a documented paid service is real and was not resolved in this research.
- **The Referer gate could tighten.** VidAPI might add Origin validation,
  Origin-and-Referer pairing, or token validation to the API endpoint at any
  time. The current free-tier grace depends on their embed business model.
- **CDN domain rotation could break.** The 4 `stream_urls` rotate per title;
  if the project caches the CDN domain, it might serve stale URLs after
  upstream changes.
- **Stream URL expiration.** HLS segments often have time-limited signing.
  Not tested in this research.
- **The 2embed obfuscation might rotate.** vidsrc.ts has 12 algorithms because
  the upstream obfuscation rotates every few weeks. The VidAPI side doesn't
  have this problem (no obfuscation), but the 2embed side does — and we don't
  have a 2embed recipe.
- **VidAPI's product pivot.** They might deprecate the free tier, raise
  prices, get acquired, or get seized by authorities. The whole category
  is fragile.
- **The project's `manifest.ts:44` design note** ("fails fast instead of
  leasing a browser") is the right constraint. Adding a VidAPI provider
  would honor that. Adding a 2embed provider would NOT (it requires a real
  browser for the iframe chain).
- **Existing project `vidking/direct.ts` is the model to follow**, not the
  Playwright-based `vidking.ts` legacy. The VidAPI provider would be the
  fifth `direct.ts`-style module in `packages/providers/src/`.

## Implementation Handoff Notes

### Shared helpers that may be reusable

- The existing `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
  pattern for provider config (would need a new `videasySessionToken` analog
  for the VidAPI Referer pattern, but actually no token is needed).
- The existing `apps/cli/src/services/playback/VidkingLazySourceProbeService.ts`
  pattern for background health probes. The VidAPI catalog endpoints
  (`/ids/movie_list_tmdb.txt`, `/movies/latest/page-N.json`) could feed a
  probe loop.
- The `apps/cli/src/services/playback/PlaybackSourceInventoryProjection.ts`
  pattern for emitting source IDs into the shell's source picker.
- The `packages/providers/src/vidking/flavors.ts` shape (with empty flavor
  set since VidAPI only has one source — `justhd`).

### Open implementation questions

- Does the project want a `vidsrc` provider that points to VidAPI, or a more
  generic `tmdb-embed` provider that abstracts over VidAPI + 2embed? The
  former is what the existing pattern suggests; the latter would be
  premature.
- Should the project emit a usage metric when calling the API? The VidAPI
  embed business model is driven by iframe views; CLI usage is invisible to
  them, which is good for stealth but also means no telemetry to know if
  the IP gets flagged.
- Should the project surface "this title is unavailable in VidAPI" (the
  Arcane S2E1 case) as a clean error message or a generic "no sources" UI?
- Is the 4 `stream_urls` set worth showing as 4 separate "servers" in the
  UI, or should we just pick the best and call it a day? (Probably the
  latter — they're the same content at different bitrates.)

### Things the next agent should not assume

- The `playToken` field is decorative. Do not implement playToken rotation,
  caching, or refresh logic. The API works without it.
- The `hostDomain` field does not gate the API. Do not implement hostDomain
  validation.
- The 4 `stream_urls` are 4 quality variants, not 4 sources. Do not show
  them as separate "servers" in the UI.
- The VidAPI `isAnimeProvider` should be `false`; the anime detection in the
  existing project uses MAL lookup independently.
- The `ds_lang` OpenSubtitles integration in VidAPI docs may be stale; do
  not promise subtitle support from a VidAPI provider module.
- The vidsrc.sbs domain is a different provider and should not be conflated
  with VidAPI.
- The 2embed.cc / 2embed.skin stack is a separate backend that requires
  real-browser iframe execution. It is NOT a VidAPI consumer and does NOT
  have a JSON API path. Do not try to add a 2embed provider without a real
  browser fallback (which the existing project's `manifest.ts:44` design
  note explicitly forbids).
- The streaming CDN domains (`nicheauthorityengine.site`,
  `visionaryfounderslab.site`, etc.) have phishing-style names. They are
  not VidAPI itself; they are upstream CDN partners. The project should
  treat them as opaque pass-throughs.
- The `streamDataApiUrl` value in the CONFIG blob is the public, documented
  VidAPI endpoint. There is no separate "private" API. The iframe chain is
  purely UX, not a gate.
- `curl_cffi` is sufficient to defeat Cloudflare's TLS fingerprint check
  on `streamdata.vaplayer.ru`. There is no Turnstile on this endpoint. Do
  not try to install Playwright for VidAPI.
- The `vidapi.ru` site is the brand website with the full API documentation.
  Fetching it once and reading the docs is more useful than reverse-engineering
  the player page.
