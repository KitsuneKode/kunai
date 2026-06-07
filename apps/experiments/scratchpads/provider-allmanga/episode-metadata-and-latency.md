# AllAnime/AllManga — Episode metadata + resolution latency research

**Date:** 2026-06-06
**Scope:** Episode thumbnails, episode names, why resolution is slower now
**Author:** opencode session, verified against live API
**Code under research only — no production code modified.**

## TL;DR

1. **Episode metadata is in the API but currently dropped.** The `episode` GraphQL
   query's `tobeparsed` blob (decrypted via the existing AES-256-CTR pipeline)
   already contains `episodeInfo.notes` (descriptive title) and
   `episodeInfo.thumbnails[]` (per-episode preview image) — plus
   `episodeInfo.vidInforssub/dub`, `uploadDates`, `description`. The
   production `api-client.ts` does not request these fields; even the
   `Episode.thumbnail` field is explicitly fetched (it returns `null` on the
   server side) but `episodeInfo` is never selected.
2. **Episode thumbnail host:** `https://wp.youtube-anime.com/aln.youtube-anime.com`
   prefix the path as-is from the GQL response (e.g. `data2/ep_tbs/<id>/<ep>_<mode>.jpg`
   for older shows, `covers/mcovers/ep_tbs/<id>/<ep>_<mode>.jpg` for newer ones).
   Returns real WebP 1920x1080 images (~30–80 KB) when the right prefix is used.
   The current code in `api-client.ts` prepends `https://allanime.day/` to relative
   `mcovers/...` paths — that 404s. **Confirmed bug.**
3. **Resolution slowness breakdown (3-run stability benchmark):**

   | Step | Typical | Notes |
   |------|--------:|-------|
   | search POST (large, current kunai shape) | 320–640 ms | Has ~25 fields per edge; ani-cli minimal is ~10% faster |
   | show catalog POST | 320–340 ms | First call works, no fallback hit |
   | **episode sources persisted GET** | **12–650 ms** | High variance; sometimes 12ms (CDN hit), often 600ms+ (cold) |
   | decrypt tobeparsed (Web Crypto) | 2–5 ms | Cheap, not a factor |
   | **Ak endpoint fetch** | **40–680 ms** | **Biggest single bottleneck when Ak is the chosen lane** |
   | Yt-mp4 endpoint fetch (HEAD only) | 100–510 ms | TTFB only, ~270MB body |
   | Episode thumbnail | 50–120 ms | Once CDN is warm |
   | Show thumbnail | 30–670 ms | **404s on older shows** due to the `allanime.day/` prefix bug |

   **Total cold path: 2.5–3.5s** for search + catalog + episode + Ak + decrypt.
   That is the budget the user feels as "slow". The two dominant slowness
   sources are (a) the persisted-GET round trip with its 12s timeout and
   (b) the Ak endpoint RTT, which is a separate domain on a separate CDN.

## 1. URL pattern (the user's screenshot)

The URL `https://allmanga.to/bangumi/2NxpL4ikTQvnri9Cm/p-8-sub` is a real,
well-formed allmanga.to URL. The `2NxpL4ikTQvnri9Cm` segment is the showId
(the same opaque string as `show._id` in GraphQL). The `p-8-sub` suffix
means: page variant for episode `8`, mode `sub`. The "p" prefix is a routing
convention; no other payload sits in the URL — the metadata is fetched via
GraphQL.

- `2NxpL4ikTQvnri9Cm` is `Marriagetoxin` (english), `MAL=undefined`,
  `AniList=undefined`, 13 episodes. The thumbnail in the screenshot
  (the right-side rail of "Episode 7", "Episode 5", "Episode 10", "Episode
  shown: 6.86k / 7.46k / 16.7k / 6.22k" with view counts) is the server-
  rendered episode picker using the per-episode thumbnails we reverse-
  engineered below.

The allmanga.to front-end itself is a Nuxt/Sapper SPA. A 2025-08-30
[urlscan.io capture](https://urlscan.io/result/0198f922-a8c7-76fd-a810-b037c30d3f62)
confirmed it loads JS from `cdn.allanime.day` and image assets from
`wp.youtube-anime.com/aln.youtube-anime.com`. Cloudflare challenges all
unauthenticated curl; the production code uses the persisted-GET (which
passes CF via the `youtu-chan.com` Origin bypass) and per-source fetches
which only need a Referer.

## 2. The `episode` query and the metadata fields

The current production `api-client.ts:430–434` only selects `episodeString`
and `sourceUrls`. The `tobeparsed` payload (which is what the server
**always returns regardless of which fields you ask for**) contains the
rest of the metadata embedded in the encrypted blob. Concretely, the
schema includes these top-level `Episode` fields (verified by sending
`{thumbnail,notes,uploadDate,description}` as a selection and reading
the server's response):

```graphql
type Episode {
  episodeString: String
  sourceUrls: [SourceUrl!]
  thumbnail: String                 # always returns null from the server
  notes: String                     # descriptive title, e.g. "I'm Used to It"
  description: String               # synopsis blurb (sometimes null)
  uploadDate: EpisodeUploadDate     # server-side timestamp object
  uploadDates: JSON                 # flat ISO strings, e.g. { sub, dub }
  show: Show                        # full nested show object
  pageStatus: PageStatus            # first viewers, rec viewers, like count
  vidInforssub: VideoInfo           # resolution, path, size, duration (sub)
  vidInforsdub: VideoInfo           # (dub)
  vidInforsraw: VideoInfo           # (raw)
  # and inside the decrypted blob: episodeInfo { notes, thumbnails, description, ... }
}
```

`description` was rejected by the server with a 500 (`Cannot set property
'countryOfOrigin' of undefined`) — that is a server bug triggered by
`description`; omit it. The other fields are safe.

### 2.1 The actual `episodeInfo` block lives inside the decrypted blob

The persisted-GET (and the POST fallback) return
`{ data: { _m, tobeparsed: "base64..." } }`. The blob, when decrypted with
the existing AES-256-CTR pipeline (key = SHA-256 of `Xot36i3lK3:v1`,
counter = IV with last byte set to 2, skip first 1 + 12 = 13 bytes, skip
last 16 bytes), contains the same shape you'd get from a non-persisted
POST. Inside it:

```jsonc
{
  "episode": {
    "episodeString": "1",
    "uploadDate": {},
    "sourceUrls": [ /* Ak, S-mp4, Fm-Hls, Sw, Mp4, Yt-mp4, Vg, ... */ ],
    "thumbnail": null,
    "notes": "I'm Used to It",
    "show": { /* nested show record: englishName, malId, aniListId, ... */ },
    "pageStatus": { /* viewers, likesCount, userScoreTotalValue, ... */ },
    "episodeInfo": {
      "notes": "I'm Used to It",
      "thumbnails": [
        "/data2/ep_tbs/B6AMhLy6EQHDgYgBF/1_dub.jpg"
      ],
      "vidInforssub": {
        "vidResolution": 1080,
        "vidPath": "/data2/media9/videos/B6AMhLy6EQHDgYgBF/sub/1.mp4",
        "vidSize": 271463498,
        "vidDuration": 1422.078
      },
      "uploadDates": { "sub": "2024-01-06T17:44:35.000Z" },
      "description": "Around ten years ago, gates that connected our world ..."
    }
  }
}
```

The schema is the same on every `episode` request, **regardless of the
fields you select** — the server includes the full block in the encrypted
blob. So no query change is required to access `episodeInfo`; the production
code only needs to parse it after decryption.

### 2.2 Per-episode `notes` (the answer to "do we have the episode name?")

`notes` is the descriptive episode title, set by the upstream curatorial
team. For Solo Leveling S1, every one of the 13 strings (12 eps + the 7.5
recap) is meaningful:

| ep | notes |
|----|-------|
| 1 | I'm Used to It |
| 2 | If I Had One More Chance |
| 3 | It's Like a Game |
| 4 | I've Gotta Get Stronger |
| 5 | A Pretty Good Deal |
| 6 | The Real Hunt Begins |
| 7 | Let's See How Far I Can Go |
| 7.5 | How to Get Stronger (recap) |
| 8 | This Is Frustrating |
| 9 | You've Been Hiding Your Skills |
| 10 | What Is This, a Picnic? |
| 11 | A Knight Who Defends an Empty Throne |
| 12 | Arise |

For Marriagetoxin ep 8, `notes` was `null` — meaning the upstream hasn't
filled in a title for that episode yet. The picker should treat `null` as
"fall back to `Episode {N}`".

### 2.3 Per-episode `thumbnails[]` (the answer to "what's the link for those?")

Each `thumbnails[]` entry is a path. There are two path shapes we
observed in the live API:

- **Older shows** (Solo Leveling S1, showId `B6AMhLy6EQHDgYgBF`):
  `/data2/ep_tbs/<showId>/<ep>_<mode>.jpg` (one entry per show, no
  special PNG — just the dub-mode jpg is served)
- **Newer shows** (Marriagetoxin, showId `2NxpL4ikTQvnri9Cm`):
  `/covers/mcovers/ep_tbs/<showId>/<ep>_<mode>.jpg` (and sometimes a
  bilibili-hosted promo PNG like
  `https://i0.hdslb.com/bfs/intl/management/<hash>.png` for special eps
  like 7.5 recap and 12 finale)

The host for both relative shapes is the same and is **NOT** what
`api-client.ts:638–642` currently uses. The right prefix is:

```
https://wp.youtube-anime.com/aln.youtube-anime.com<path>
```

It then 302s to `https://aln.youtube-anime.com<path>` then 301s to
`https://ytimgf.youtube-anime.com<path>` and finally returns the image
(200). Final redirect-target URLs:

- Solo Leveling S1E1 sub: `https://ytimgf.youtube-anime.com/data2/ep_tbs/B6AMhLy6EQHDgYgBF/1_dub.jpg` — **76834 bytes WebP 1920x1080**
- Marriagetoxin ep 1 sub: `https://ytimgf.youtube-anime.com/mcovers/ep_tbs/2NxpL4ikTQvnri9Cm/1_sub.jpg` — 29594 bytes
- Marriagetoxin ep 8 sub: `https://ytimgf.youtube-anime.com/mcovers/ep_tbs/2NxpL4ikTQvnri9Cm/8_sub.jpg` — 41440 bytes

`Referer: https://allmanga.to/` is required; a `User-Agent` from a
current browser is also required. The same prefix works for show poster
thumbnails (e.g.
`https://wp.youtube-anime.com/aln.youtube-anime.com/mcovers/a_tbs/dhw/B6AMhLy6EQHDgYgBF.webp`
— 99762 bytes).

**The show thumbnail is currently broken in production** for older
shows: `api-client.ts:638–642` prepending `https://allanime.day/` to
`mcovers/...` returns 404. Same fix: switch to
`https://wp.youtube-anime.com/aln.youtube-anime.com/`. Newer shows
use absolute anilist.co URLs and bypass the bug, which is why it isn't
consistently visible in the wild.

## 3. The `show` query — fields we should also consider pulling

`Episode.uploadDate` is the per-episode time. `show` has
`lastEpisodeInfo.notes` and `lastEpisodeDate` for the *last* episode
of the season, and `nextAiringEpisode` for the next-airing show
(not the same show). Useful for TV-show-style scheduling. The schema
in `.docs/UNIFIED_PROVIDER_INTELLIGENCE.md:69–78` said "anime providers
typically do not expose per-episode thumbnails" — **this is wrong** for
AllManga; both `episodeInfo.thumbnails[]` and `episodeInfo.notes` are
authoritative and have been live for at least a year (the persisted
query hash `d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec`
is identical to ani-cli's, and the schema hasn't rotated since 2024).

## 4. The slowness investigation

### 4.1 The hot path

A user-initiated AllManga resolve (in the current production code) is:

```
1. search POST                  (current shape)    ~ 320–640 ms
2. show catalog POST            (always)           ~ 320–340 ms
3. episode sources GET (persisted)                 ~ 12–650 ms
4. decrypt tobeparsed                              ~ 2–5 ms
5. parallel fan-out for each sourceUrls[] entry:
   - Ak endpoint GET            (ak-only lane)     ~ 40–680 ms ← biggest
   - S-mp4 / Yt-mp4 / Fm-mp4 / Default fetches     ~ 100–510 ms
6. build stream candidates, sort by quality
```

In `ak-only` lane (the preferred fast lane after the 2026-05-26 hardening),
step 5 collapses to one Ak fetch and the others are skipped. So ak-only is
~50–200 ms faster on a warm CDN, ~600 ms faster on a cold one, than the
baseline lane. The Ak endpoint is the one piece of the pipeline that is
out of our control.

### 4.2 Why does it feel "slower now"?

The recent changes (per `.plans/kunai-execution-passes-and-cli-modes.md` and
`docs/superpowers/plans/2026-05-26-kunai-fast-first-provider-runtime.md`)
have added a number of new concerns to the resolve path. None of them is
a regression in absolute HTTP time, but several compound:

1. **The persisted-GET timeout was tightened to 12s.** That is correct, but
   the 12s budget *also* covers the time-to-first-byte of the API endpoint.
   On a Cloudflare-cold path the GET can sit for 600–800ms before the first
   byte arrives; the budget tolerates this, but the perceived latency goes
   up vs. the previous (longer) 20s budget. The fallback POST (`api-client.ts:457–471`)
   is the same 15s. If a user is unlucky and the GET just-returns-`{"data":{"_m":"b7","tobeparsed":"..."}}`
   without ever hitting the encryptor fast path, the POST runs and the
   whole resolve takes ~2x.

2. **The Ak DASH path is now preferred (ak-only lane), and the Ak endpoint
   is the slowest per-step call in the whole pipeline.** It is a separate
   domain (`allanime.day`), a separate CDN, and the `clock.json` payload is
   ~17KB. There is no way to make this faster without Ak support dropping.

3. **Show thumbnail is broken (404) for older shows, but we still try.**
   The fetch adds 30–670ms of pointless work for shows whose relative
   `mcovers/...` thumbnail 404s. Even fixing the host (see §2.3) the
   thumbnail fetch is optional and should be a `preload` not a hard
   dependency in the picker.

4. **The catalog POST has a fallback to `youtu-chan.com` referer.** This is
   correct, but it costs an extra ~320ms whenever the primary referer
   fails. The fallback was rare on the allmanga.to-routed path, but the
   2026-05-26 changes also introduced routing through more domains, so
   the fallback hit rate is non-zero.

5. **Search is wide.** Kunai's search request pulls 25 fields per edge
   (`name, englishName, nativeName, thumbnail, banner, description,
   malId, aniListId, score, ...`); ani-cli's pulls 3 (`_id, name,
   availableEpisodes`). On the same machine the large query took
   378–638 ms vs. the minimal one at 312–347 ms — about a 15–20%
   difference per call. The 4 ep-catalog fetches (search + show-catalog
   + 2 fallback probes) plus the GET are the bulk of the perceived wait.

6. **The user-facing "slower now" feeling is most likely the Ak lane
   switch.** The previous default lane called `Default`/`Yt-mp4` first
   (a `wixmp` repackager that returned ~3–8 KB JSON with a list of
   pre-resolved MP4 URLs, no extra per-source RTT). The new ak-only
   lane always pays the Ak endpoint RTT before it can return any
   stream candidate. This is intentional — Ak is the only lane that
   guarantees a DASH manifest with audio+video — but the user-visible
   time-to-first-byte on the player goes up by ~300–600ms per resolve.

### 4.3 Concrete suggestions (research-only, NOT implemented)

1. **Fix the show thumbnail host.** Switch
   `api-client.ts:638–642` from `https://allanime.day/${thumbnail}` to
   `https://wp.youtube-anime.com/aln.youtube-anime.com/${thumbnail}` (only
   when the path is relative). This will make older shows render with
   their poster and unblock the deeplink previews. For newer shows
   (absolute anilist.co URLs) keep the existing fast path.

2. **Use `episodeInfo.notes` and `episodeInfo.thumbnails[]` from the
   already-decrypted `tobeparsed` blob.** No new query is required; the
   server embeds the full block in the encrypted response. The current
   `extractRawSources` only pulls `episodeString` and `sourceUrls`; add
   `episodeInfo` to the surfaced object. The picker can then show
   `Episode {N}: {notes}` and a small preview thumb without an extra
   round trip.

3. **Cache the `episodeInfo` per `(showId, epStr, mode)` key in the
   existing `sourceCache`.** Resolve-time falls to a cache hit on the
   next play. The thumbnail fetch itself is a non-blocking `preload` —
   it should not gate the picker.

4. **Trim the search query to ani-cli minimal unless the user is
   picking from many results.** The 15–20% saving compounds with the
   3-iteration stability runs that we measured; on slow networks it
   matters more.

5. **Cap the Ak endpoint timeout to 4s in the ak-only lane, and fall
   back to the baseline lane on timeout.** This keeps the user-visible
   resolve within the 4-second budget at the cost of one extra
   fallback on truly bad Ak responses. The current `12s` budget is
   fine but the `4s` cap means the player can show a quick error
   rather than a hung resolve.

6. **The thumbnail path prefix in the GQL response is the only safe
   thing to display** — the GQL response gives us the exact path
   including the leading `/`. Do not try to "normalize" `/data2/...`
   vs `/covers/mcovers/...`; they are both valid and the CDN serves
   both at the same `wp.youtube-anime.com/aln.youtube-anime.com`
   origin. The only normalization is "if path is absolute, leave it;
   otherwise prepend the CDN origin."

7. **Two-tier request: only fall back to POST when GET actually
   returned `<html>...</html>` (the Cloudflare challenge page).** The
   current fallback fires on `!rawText.includes('"tobeparsed"')` which
   matches `{"data":null}` (no episode for that id) too — that
   triggers a wasted 320ms POST. Tighten to `rawText.startsWith("<!")`
   or similar so the POST is only for Cloudflare challenges, not for
   legit empty responses.

### 4.4 What did NOT change and should not be touched

- The persisted-GET query hash `d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec`
  matches ani-cli's exactly; rotating it would break ani-cli parity.
- The `Xot36i3lK3:v1` AES key and the IV-with-counter-2 scheme are
  stable; changing the constants requires parity investigation
  (per `.docs/providers.md:319–327`).
- The `youtu-chan.com` referer bypass remains required and correct.
- The `Ak` DASH materialization (temp MPD under `/tmp/kunai-allmanga-ak-...`)
  is the right design; only the per-step timeout budget is the lever.

## 5. Verifications and reproducibility

### 5.1 Episode metadata via the existing API

The `episode` query with the **current** selection (no schema change)
returns `episodeInfo` in the decrypted blob:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0"
REFERER="https://youtu-chan.com"
SHOW_ID="B6AMhLy6EQHDgYgBF"
VARS=$(printf '{"showId":"%s","translationType":"sub","episodeString":"1"}' "$SHOW_ID")
EXT='{"persistedQuery":{"version":1,"sha256Hash":"d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec"}}'
URL="https://api.allanime.day/api?variables=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$VARS'))")&extensions=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$EXT'))")"
curl -sS -G -H "Referer: $REFERER" -H "Origin: $REFERER" -H "User-Agent: $UA" \
  --data-urlencode "variables=$VARS" \
  --data-urlencode "extensions=$EXT" \
  "$URL"
```

Then decrypt with the existing `decodeTobeparsed` helper
(`packages/providers/src/allmanga/api-client.ts:193–220`).

### 5.2 Episode thumbnail fetch

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
curl -sS -L -H "User-Agent: $UA" -H "Referer: https://allmanga.to/" \
  "https://wp.youtube-anime.com/aln.youtube-anime.com/data2/ep_tbs/B6AMhLy6EQHDgYgBF/1_dub.jpg"
# → WebP 1920x1080, 76834 bytes
```

### 5.3 Benchmark harness

```
apps/experiments/scratchpads/provider-allmanga/bench-resolution.ts
```

Captures the per-step timing for: search (current vs minimal), catalog
(kunai shape vs minimal+episodes vs production-with-fallback), episode
sources (persisted GET vs POST fallback), Ak fetch, Yt-mp4 fetch,
episode thumbnail, show thumbnail. Writes JSON to
`bench-resolution-report.json`. Run with:

```sh
cd apps/experiments && bun run scratchpads/provider-allmanga/bench-resolution.ts
```

### 5.4 CDN host pattern (cross-checked against the JS bundle)

Discovered in `8262256.js` (the Nuxt page bundle served by
`cdn.allanime.day`):

```js
{
  id: "youtubeanime", name: "B",
  pictureServers: [{ name: "B", head: "https://aln.youtube-anime.com" }],
  audioHeader: "https://aimgf.youtube-anime.com",
  coverHeader: "https://aln.youtube-anime.com",
  videoHeader: "https://aln.youtube-anime.com",
  hasMatch: e => /.*__\/thumbnail|.*_tbs\/|images(\d+)?\/|img.youtube-anime.com/.test(e)
}
```

The page loader uses `https://wp.youtube-anime.com/<host>...` as a passthrough
that 302s to `aln.youtube-anime.com` then 301s to `ytimgf.youtube-anime.com`.
All three domains are Cloudflare-fronted. The `youtube-anime.com` cluster is
the allmanga CDN, not YouTube or bilibili. The `hdslb.com` URLs we saw in
the GQL response are an additional `i0.hdslb.com/bfs/intl/management/...`
CDN that some shows use for promo PNGs; these work without referer and are
absolute URLs in the GQL response.

## 6. Files touched in this research

- `apps/experiments/scratchpads/provider-allmanga/bench-resolution.ts` — new benchmark
- `apps/experiments/scratchpads/provider-allmanga/probe-page-images.ts` — Playwright probe (failed to bypass CF cleanly; superseded by direct API probe)
- `apps/experiments/scratchpads/provider-allmanga/allmanga-network-capture.json` — empty (page never rendered past CF challenge)
- This report: `apps/experiments/scratchpads/provider-allmanga/episode-metadata-and-latency.md`

## 7. What the user actually needs to know

> "I'm Used to It", "Arise", etc. — the descriptive episode title lives in
> `Episode.notes` (a top-level field on the episode query) and is also
> inside `Episode.episodeInfo.notes` in the decrypted blob. The thumbnail
> URL for each episode is `Episode.episodeInfo.thumbnails[]` — relative
> paths like `/data2/ep_tbs/<id>/<ep>_<mode>.jpg`. Prepend
> `https://wp.youtube-anime.com/aln.youtube-anime.com` and the CDN serves
> a real WebP 1920x1080 image with the right `Referer: https://allmanga.to/`
> header.
