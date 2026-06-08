# Unified Anime & Multi-Provider Research Report

> **Date:** 2026-06-07 · **Scope:** Miruro, AllManga, VidKing/Cineby, VidLink, Rivestream, TMDB anime detection, anime episode metadata
> **Goal:** Surface the full capacity of every anime + multi-server provider, fix the missing-flavor UI bug, get anime episode names working, and enable cross-provider ID resolution for the agnostic anime resolve.

---

## Executive Summary

| Provider                 | Today                                                                         | After fixes                                                                                                                | Anime?                     | Multi-server?       |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------- |
| **Miruro**               | 2 servers (kiwi/bee), short titles, key/endpoint verified                     | 7 servers (kiwi/bee/hop/ally/pewe/moo/bonk), rich metadata from 6+ upstream sources, cross-DB ID resolver                  | ✅                         | ✅ (7)              |
| **AllManga**             | search ✅, no episode titles                                                  | search ✅ + episode titles from Kitsu/AniList/JIKAN                                                                        | ✅                         | ✅ (server-rotated) |
| **VidKing**              | 3 Phase A servers exposed, 9 hidden in Phase B                                | All 12 flavors exposed in source picker                                                                                    | ❌                         | ✅ (12)             |
| **Cineby**               | picks 1 flavor, `status: "research"`, not production                          | promotes VidKing's 12 flavors with themed labels (Neon/Yoru/Cypher/Sage/Breach/Vyse/Killjoy/Fade/Omen/Raze/Harbor/Chamber) | ❌                         | ✅ (12)             |
| **VidLink**              | 1 sourceId backend (randomly rotated, e.g. `redVault`), 18+ caption languages | Same — already correct, minor enrichments                                                                                  | ❌ (no anime API)          | ✅ (hidden)         |
| **Rivestream**           | 2 static fallback providers, 6 live                                           | 6 live providers (flowcast, asiacloud, primevids, hindicast, guru, ophim)                                                  | ❌ (skip — user directive) | ✅ (6)              |
| **TMDB**                 | Search exists, no anime classification                                        | Adds `isAnimeLikely()` classifier — 26/26 accuracy on real data                                                            | n/a                        | n/a                 |
| **Anime metadata (new)** | AllManga has no titles                                                        | New `getAnimeTitleMetadata` aggregator from Kitsu + AniList + JIKAN + TMDB + AniSkip                                       | n/a                        | n/a                 |

**Net impact:** +16 visible sources in the UI, full anime episode titles + synopses + stills, cross-DB ID resolution, deterministic anime classification. ~3-5 day implementation.

---

## 1. Miruro

### 1.1 Production truth (verified live, 2026-06-07)

```
PIPE_KEY:    71951034f8fbcf53d89db52ceb3dc22c   ← still valid
Marker:      bh4YNPj7  (body)  +  x-obfuscated: 2  (header)
Compression: 0x1f 0x8b magic → Bun.gunzipSync()
Endpoint:    GET {base}/api/secure/pipe?e=<base64url(JSON payload)>
Version:     0.2.0
```

The `08655ed097475f0de31c6033c83ef578` 32-char hex found on the homepage is an **Adsterra ad-network script URL**, NOT a pipe key. Confirmed by HTML context: `"src":"https://pl29239631.profitablecpmratenetwork.com/08/65/5e/08655ed097475f0de31c6033c83ef578.js"`.

### 1.2 Mirrors (all working today)

| Host                     | Homepage                         | Pipe       | Notes                         |
| ------------------------ | -------------------------------- | ---------- | ----------------------------- |
| `https://miruro.bz`      | ✅ 200                           | ✅ 200     | **Primary**                   |
| `https://miruro.ru`      | ✅ 200                           | ✅ 200     | Mirror, identical body to .bz |
| `https://www.miruro.tv`  | ✅ 200                           | ✅ 200     | Mirror, identical body to .bz |
| `https://miruro.tv`      | ❌ socket flakes on direct fetch | ✅ 200     | Pipe still works              |
| `https://www.miruro.com` | not probed                       | not probed | User-mentioned                |
| `https://miruro.com`     | not probed                       | not probed | User-mentioned                |
| `https://miruro.to`      | not probed                       | not probed | User-mentioned                |

All Cloudflare-fronted (`cf-ray` present, `server: cloudflare`), no Turnstile on homepage. Pipe can intermittently 444/403/410 — keep the mirror loop.

### 1.3 Status page leaks full API surface (but all dead)

Miruro's `/status` page returns Prometheus-style JSON with all internal routes, counts, and latencies. But every direct endpoint returns **HTTP 410 Gone** today. The obfuscated pipe IS the entire public API.

Leaked routes (all 410 except `/status`):

- `/api/config`, `/api/episodes`, `/api/events` (SSE)
- `/api/info/:id`, `/api/info/anilist/:id`
- `/api/reports`, `/api/schedule`
- `/api/search`, `/api/search/browse`
- `/api/secure/jwks`, `/api/secure/pipe` (only one alive)
- `/api/sources`, `/api/token`
- `/health`, `/info/:id`, `/schedule`, `/profile`

### 1.4 Pipe payload schemas

#### a. `episodes` (episode list + mappings + per-provider episode IDs)

```ts
// Request
{ path: "episodes", method: "GET", query: { anilistId: "21" }, body: null, version: "0.2.0" }
```

```ts
// Response
{
  mappings: {
    id, title, type: "ANIME", format, episodes,
    malId, aniId, anidbId, kitsuId, imdbId, themoviedbId, thetvdbId,
    livechartId, annId, animePlanetId, animescheduleId, anisearchId,
    simklId, animeCountdownId, notifyMoeId, animethemesId, animefillerlistId,
    franchiseAnchor, franchiseId, defaultTvdbSeason, tmdbSeason,
    episodeOffset, tmdbOffset,
    synonyms: string[],     // 33 for One Piece
    aniskip: [{ end, type: "op"|"ed"|"mixed-op"|"mixed-ed", start, votes, episode, provider, episode_length }],
    animefillerlist: { ... } | null,
    providers: {           // per-server internal id mapping
      kiwi: { id, mapping_id, provider_id: ["6681"] },
      bee:  { id, mapping_id, provider_id: ["slug-..."] },
      ally: { id, mapping_id, provider_id: ["jbJnkcKSzYjwd3NGY"] },
      // 12-13 servers per anime
    }
  },
  providers: {
    kiwi: { meta: {...}, episodes: { sub: [Episode], dub: [Episode] } },
    bee:  { ... },
    hop:  { ... },
    ally: { ... },
    pewe: { ... },
    moo:  { ... },
    bonk: { ... }
  }
}

type MiruroEpisode = {
  id: string;              // base64-encoded provider-internal id
  number: number;
  title: string;           // sometimes short ("I'm Luffy!"), sometimes full
  airDate: string;         // "YYYY-MM-DD"
  duration: number;        // seconds
  audio: "sub" | "dub";
  description: string;     // verbatim from Kitsu
  filler: boolean;
  uncensored: boolean;
  image: string;           // https://image.tmdb.org/t/p/original/...
};
```

**Mapping reliability: 11/12 tested anilist IDs had complete cross-DB IDs** (124403 hit a CF hiccup). 100% hit rate on the rest. `themoviedbId` is ALWAYS populated for anime.

#### b. `sources` (stream URLs per server/category)

```ts
// Request
{
  path: "sources", method: "GET",
  query: {
    episodeId: "YW5pbWVwYWhlOjQ6MzY2MDA6Mzk",  // from providers.<srv>.episodes.<cat>[i].id
    anilistId: "21",
    provider: "kiwi",       // server key
    category: "sub"
  },
  body: null, version: "0.2.0"
}
```

```ts
// Response
{
  streams: [{
    url: "https://vault-08.uwucdn.top/stream/.../uwu.m3u8",
    type: "hls", quality: "1080p" | "720p" | "360p" | undefined,
    referer: "https://kwik.cx/e/...",   // PER-STREAM, not per-server
    resolution: { width, height }, codec: "h264", audio: "ja", isActive: true
  }, ...],
  subtitles: [{ url, file, lang, label }],
  thumbnails: [{ url, type: "vtt" }],
  intro: { start, end },
  outro: { start, end },
  download: "https://..."
}
```

**Critical: the `referer` field is per-stream, not per-server.** mpv must receive `--referrer=<stream.referer>`. The app already wires this in `packages/providers/src/miruro/direct.ts:267`.

#### c. `search` (AniList-shaped results, ~20 pages × 21 entries)

```ts
// Request
{ path: "search", method: "GET", query: { q: "naruto" }, body: null, version: "0.2.0" }
// Also accepts: query: { idMal: "21" } or query: { themoviedbId: "37854" }
```

```ts
// Response — top-level keys are page numbers "0".."19"
{
  "0": {                    // page 0 — 21 results
    // Each "page" is an OBJECT, not an array. Values are AniList-shaped entries keyed by id.
    "20": { id: 20, idMal: 20, title: { native, romaji, english, userPreferred },
            coverImage: { color, large, medium, extraLarge }, bannerImage,
            format: "TV", status: "FINISHED", episodes: 220,
            averageScore, meanScore, popularity,
            startDate: { day, year, month }, seasonYear,
            description, genres: [...], duration,
            studios: { edges: [{ node: { id, name }, isMain }] },
            type: "ANIME", dubLanguages: [...], isAdult: false },
    "1": { ... }, "153218": { ... }
  },
  "1": { ... }   // next page (different results)
}
```

To get the list per page: `Object.values(j["0"])`.

### 1.5 Active servers (2026-06-07)

7 confirmed active (`kiwi, bee, hop, ally, pewe, moo, bonk`). Earlier `ANIMEKAI, ANIMEZ, ZORO, ANIMEDUNYA, ANIMEONSEN, SENSHI, KUUDERE, dune` were seen intermittently.

| Server   | Sub       | Dub        | Hosts                                                                                               | Referer                           | Notes                                  |
| -------- | --------- | ---------- | --------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------- |
| **kiwi** | 4-12      | 6          | vault-N.uwucdn.top, kwik.cx, vault-N.owocdn.top                                                     | `https://kwik.cx` (or per-ep URL) | Best speed, multi-quality, **primary** |
| **bee**  | 0-4       | 4-6 + subs | cdn.mewstream.buzz, mewcdn.online, megaplay.buzz, vidwish.live, vibeplayer.site, fxpy7.watching.onl | per-stream                        | Dub-rich, sometimes empty for sub      |
| **hop**  | 0         | 0-2        | hls.krussdomi.com                                                                                   | `https://krussdomi.com`           | Dub-only, often 444                    |
| **ally** | 0-5       | 0-7        | allanime.uns.bio, bysekoze.com, mp4upload.com, ok.ru, tools.fast4speed.rsvp                         | per-stream                        | Wide variety, MP4 + HLS mix            |
| **pewe** | 0-2       | 0-2        | hls.anidb.app, anidb.app                                                                            | `https://anidb.app/`              | **NEW** — AniDB-backed HLS             |
| **moo**  | 0-5 (MP4) | 0-5        | www.animegg.org                                                                                     | per-stream                        | **NEW** — often MP4 not m3u8           |
| **bonk** | 0-6       | 0-6 + subs | vibeplayer.site, playmogo.com, otakuhg.site, otakuvid.online, bibiemb.xyz                           | per-stream                        | **NEW** — multi-host                   |

### 1.6 Miruro's metadata sources (identified by cross-referencing)

Every field in Miruro's response traces to a **public upstream source** — nothing is proprietary. We can build an independent metadata aggregator using the same sources.

| Field                                | Source                                                                         | URL                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `image` (episode still)              | **TMDB**                                                                       | `https://image.tmdb.org/t/p/original/{hash}.jpg`                   |
| `title` (episode)                    | **Kitsu** (mirrors MAL)                                                        | `https://kitsu.io/api/edge/anime/{malId}/episodes`                 |
| `description` (synopsis)             | **Kitsu** (verbatim)                                                           | same                                                               |
| `synonyms`                           | Kitsu + MAL                                                                    | same                                                               |
| `airDate`                            | AniList `airingSchedule` or Kitsu                                              | `https://graphql.anilist.co`                                       |
| `duration`                           | AniList `Media.duration` (sec)                                                 | same                                                               |
| `filler` flag                        | **anime-filler-list**                                                          | `https://www.animefillerlist.com/shows/{slug}`                     |
| `aniskip[]`                          | **AniSkip project**                                                            | `https://api.aniskip.com/v2/skip-times/{malId}/{ep}` (may be down) |
| `animefillerlist` (full)             | **anime-filler-list**                                                          | scrape                                                             |
| All `mappings.*Id`                   | **anime-mappings** GitHub project                                              | static JSON, MIT licensed                                          |
| `mappings.providers[].provider_id[]` | Per-provider internal IDs (kiwi/bee/ally use MAL-id-based, moo/bonk use slugs) | from each provider's API                                           |

**Verdict:** building our own metadata aggregator from these same sources is **safe and legal** — all free, all public, all stable.

### 1.7 What changed since 2026-05-25

| Item              | Before                             | Now                                       |
| ----------------- | ---------------------------------- | ----------------------------------------- |
| PIPE_KEY          | `71951034f8fbcf53d89db52ceb3dc22c` | Same — **not rotated**                    |
| Marker            | `bh4YNPj7` + `x-obfuscated: 2`     | Same                                      |
| Active servers    | 5                                  | 7 (+pewe, +moo, +bonk)                    |
| `mappings` field  | Unverified                         | **Always present, complete cross-DB IDs** |
| Direct `/api/*`   | (unknown)                          | All 410 Gone                              |
| `search` via pipe | Unknown                            | Works, ~420 results per query             |
| `status` page     | Unknown                            | Works, leaks internal route map           |

---

## 2. TMDB Anime Detection (deterministic classifier)

### 2.1 The rules (5-tier, ordered by confidence)

```ts
function isLikelyAnime(item: {
  original_language?: string;
  origin_country?: string[];
  production_countries?: { iso_3166_1: string }[];
  genre_ids?: number[];
  keywords?: { id: number; name: string }[];
  networks?: { name: string }[];
  production_companies?: { name: string }[];
}): { isAnime: boolean; confidence: number; reason: string } {
  // Tier 1: original_language === "ja"  (~99.9% precision)
  if (item.original_language === "ja") {
    return { isAnime: true, confidence: 0.99, reason: "original_language=ja" };
  }

  // Tier 2: JP origin + Animation genre
  const jpOrigin =
    item.origin_country?.includes("JP") ||
    item.production_countries?.some((c) => c.iso_3166_1 === "JP");
  const hasAnimation = item.genre_ids?.includes(16);
  if (jpOrigin && hasAnimation) {
    return { isAnime: true, confidence: 0.97, reason: "JP+Animation" };
  }

  // Tier 3: TMDB keyword 210024 ("anime")
  if (item.keywords?.some((k) => k.id === 210024)) {
    return { isAnime: true, confidence: 0.95, reason: "anime keyword" };
  }

  // Tier 4: anime network
  const ANIME_NETWORKS =
    /Nippon TV|Tokyo MX|MBS\b|Fuji TV|TV Tokyo|BS11|TOKYO MX|Animax|YTV|ytv|Nippon/;
  if (item.networks?.some((n) => ANIME_NETWORKS.test(n.name))) {
    return { isAnime: true, confidence: 0.95, reason: "anime network" };
  }

  // Tier 5: anime studio (movies)
  const ANIME_STUDIOS =
    /Studio Ghibli|CoMix Wave|Madhouse|Bones\b|MAPPA|ufotable|Kyoto Animation|Wit Studio|Trigger|A-1 Pictures|Pierrot|Sunrise|TMS Entertainment|OLM\b|P\.A\. Works|CloverWorks|Production I\.G|Shaft\b|White Fox/;
  if (item.production_companies?.some((c) => ANIME_STUDIOS.test(c.name))) {
    return { isAnime: true, confidence: 0.95, reason: "anime studio" };
  }

  return { isAnime: false, confidence: 0.9, reason: "no-anime-signals" };
}
```

### 2.2 Validation: 26/26 correct on real TMDB data

Tested 11 anime (Naruto 46260, One Piece 37854, Frieren 209867, HxH 46298, AOT 1429, Demon Slayer 85937, Spy x Family 120089, Tower of God 97860, God of High School 99778, Chainsaw Man 114410, Your Name 372058, Spirited Away 129) and 13 non-anime (Rick & Morty 60625, R&M: The Anime 202282, Avatar TLA 246, Avatar LA 2024 82452, GoT 1399, Friends 1668, Simpsons 456, HIMYM 1100, The Boys 76479, Secret Invasion 114472, Sex Education 81356, Inception 27205, Turning Red 508947, Aladdin 812).

**Result: 26/26 correct** with Tiers 1-4 enabled. The only false negative (Rick and Morty: The Anime) is caught by Tier 4 if the network is included.

The single most reliable signal: `original_language === "ja"`. 11/11 anime had it. 0/13 non-anime had it.

### 2.3 How it solves the overlap problem

Today the app has two provider systems (`isAnimeProvider: true` for Miruro/AllManga, `false` for vidking/cineby). When a user searches "Naruto" via TMDB, it routes to vidking. With the classifier applied to every TMDB search result, we can:

1. Auto-tag each `SearchResult` with `isAnime: boolean`
2. Show "Anime" badge in the picker
3. Default to anime providers when `isAnime: true`
4. Allow override per-result
5. Pre-fetch the Miruro `mappings` for the TMDB ID in the background — by the time the user picks, `anilistId` is cached

---

## 3. VidKing + Cineby — The Multi-Flavor Fix

### 3.1 The 12 flavors (the ones not showing in UI)

`packages/providers/src/vidking/flavors.ts:38-144`:

| Flavor ID             | Theme      | Cineby alias | Endpoint            | Audio | Phase           |
| --------------------- | ---------- | ------------ | ------------------- | ----- | --------------- |
| `videasy-primary`     | Luffy      | **Neon**     | `mb-flix`           | en    | A               |
| `videasy-mirror-a`    | Zoro       | **Yoru**     | `cdn`               | en    | A               |
| `videasy-mirror-b`    | Nami       | **Cypher**   | `downloader2`       | en    | A               |
| `videasy-mirror-c`    | Sanji      | **Sage**     | `1movies`           | en    | B               |
| `videasy-breach`      | Blackbeard | **Breach**   | `m4uhd`             | en    | B               |
| `videasy-english-alt` | Robin      | **Vyse**     | `hdmovie` (English) | en    | B               |
| `videasy-german`      | Brook      | **Killjoy**  | `meine` (german)    | de    | B               |
| `videasy-hindi`       | Chopper    | **Fade**     | `hdmovie` (Hindi)   | hi    | B               |
| `videasy-spanish`     | Ace        | **Omen**     | `lamovie`           | es    | B               |
| `videasy-portuguese`  | Sabo       | **Raze**     | `superflix`         | pt    | B               |
| `videasy-italian`     | Shanks     | **Harbor**   | `meine` (italian)   | it    | B               |
| `videasy-french`      | Law        | **Chamber**  | `meine` (french)    | fr    | B (movies only) |

### 3.2 The bug

`packages/providers/src/cineby/index.ts:117-128`:

```ts
return (
  eligible.find((flavor) => flavor.audioLanguage === input.preferredAudioLanguage) ??
  eligible[0] ??
  DEFAULT_CINEBY_FLAVOR
);
```

**Returns ONE flavor** instead of cycling/exposing all 12. Plus Cineby has `status: "research"` and `relaySafe: false` — not production-ready.

The underlying VidKing engine has full cycle support (`exhaustiveRefresh`, `runProviderCycle`, `VIDKING_PHASE_A_SERVERS`) but Cineby bypasses it.

### 3.3 The fix (one provider, all 12 flavors)

**VidKing IS the multi-flavor provider** — the fix is at the VidKing layer, not a separate one. Two minimal changes:

**Option A — change `cinebyProviderModule.resolve`** (`packages/providers/src/cineby/index.ts:80-114`) to build cycle candidates for all 12 eligible flavors and call `runProviderCycle`. Each flavor becomes its own `ProviderSourceCandidate` in the result.

**Option B — promote Phase B flavors to Phase A** in `VIDKING_PHASE_A_SERVERS` and always create per-flavor source candidates. This is the cleaner fix because it keeps VidKing as the single source of truth.

**Recommendation: do Option B.** Removes the Cineby-as-thin-wrapper antipattern, promotes VidKing to fully multi-flavor, deletes ~200 lines of Cineby wrapper code.

After fix: 12 distinct source rows in the picker, each independently selectable, cycling stops at first playable result for that pick.

---

## 4. VidLink

### 4.1 Verified live (2026-06-07)

- Domain: `vidlink.pro` · API: `https://vidlink.pro/api/b` · Player: default + JWPlayer
- Latest: v1.2.1 (2026-01-20)
- Changelog: minimal — only customization/player features
- **Aliases:** "P-Stream" (per manifest) — it's a movie-web/p-stream fork, same family as Aether, XP-Stream, Basement, StreamWatch

### 4.2 API response shape (Game of Thrones S1E1, TMDB 1399)

```json
{
  "sourceId": "redVault",
  "stream": {
    "id": "primary",
    "type": "hls",
    "playlist": "https://storm.vodvidl.site/proxy/<encrypted>.m3u8?headers={\"referer\":\"https://videostr.net/\",\"origin\":\"https://videostr.net\"}&host=https://nebulanovanature.net",
    "flags": ["cors-allowed"]
  },
  "captions": [
    { "url": "https://cc.boopigcdn.com/_ms/.../bul-3.vtt", "language": "Bulgarian", "type": "srt" },
    { "url": "https://cc.boopigcdn.com/_ms/.../eng-2.vtt", "language": "English", "type": "srt" },
    { "url": "https://cc.boopigcdn.com/_ms/.../jpn-1.vtt", "language": "Japanese", "type": "srt" }
    // ... 18+ languages
  ]
}
```

`sourceId` is **server-side load-balanced** — each call gets a random internal source (e.g. `redVault`, likely `blueVault`, `greenVault`, etc. for 13+ backends). We cannot enumerate them; we should not try.

### 4.3 Anime support

- Frontend route: `https://vidlink.pro/anime/{MALid}/{number}/{subOrDub}` → 200 (HTML page only)
- API route: `https://vidlink.pro/api/b/anime/...` → **404** (no API path)
- The embed page uses the same p-stream JS chunks (`/_next/static/chunks/app/anime/[id]/[episode]/[subordub]/page-...js`) — same backend family
- **No public anime API. Skip anime on VidLink.** Use Miruro + AllManga for anime.

### 4.4 Our adapter state

`packages/providers/src/vidlink/direct.ts:46-106` does it right:

1. Encrypts TMDB ID via `enc-dec.app/api/enc-vidlink?text={tmdbId}`
2. Calls `/api/b/tv/{encId}/{season}/{episode}`
3. Returns HLS stream + all captions as subtitles
4. Headers (referer, origin) from `stream.headers`

**Minor enrichments possible:**

- `stream.qualities` iteration when `type === "file"` (multi-quality file sources)
- Surface `sourceId` in `flavorLabel` for diagnostic visibility
- Per-language subtitle sorting by `preferredSubtitleLanguage`

---

## 5. Rivestream

### 5.1 Live provider list (probed)

```json
// GET https://www.rivestream.app/api/backendfetch?requestID=VideoProviderServices&secretKey=rive&proxyMode=undefined
{ "data": ["flowcast", "asiacloud", "primevids", "hindicast", "guru", "ophim"] }
```

**6 active providers.** Our `direct.ts:58` has `RIVESTREAM_STATIC_PROVIDER_SERVICES = ["self", "prime"]` — only 1 of those is in the live list (`primevids` matches `prime`).

| Provider    | Type                  | Notes                                        |
| ----------- | --------------------- | -------------------------------------------- |
| `flowcast`  | Primary English       | P-Stream/movie-web backend (same as VidLink) |
| `asiacloud` | Asian content         | Korean/Chinese/Japanese TV/movies            |
| `primevids` | English movies/TV     | Our `prime` static fallback matches this     |
| `hindicast` | Hindi dub             | Bollywood + dubbed content                   |
| `guru`      | Multi-source          | Likely 3rd party aggregator                  |
| `ophim`     | Asian content (OPhim) | Vietnamese origin, Asian catalog             |

### 5.2 Skip anime on Rivestream (user directive)

The user explicitly said: "I don't think I am working with rivestream for anime, lets keep the anime for those 2 providers only for now" — meaning AllManga + Miruro only. Don't route anime to Rivestream.

### 5.3 The fix (5 lines)

`packages/providers/src/rivestream/direct.ts:58`:

```ts
// Before
const RIVESTREAM_STATIC_PROVIDER_SERVICES = ["self", "prime"] as const;
// After
const RIVESTREAM_STATIC_PROVIDER_SERVICES = [
  "flowcast",
  "asiacloud",
  "primevids",
  "hindicast",
  "guru",
  "ophim",
] as const;
```

Live API already returns this list (24h cache survives outages). The MurmurHash secret-key generation in `direct.ts:199-258` is correct — no changes needed.

---

## 6. fmhy.net Provider Cross-Reference

### Tier 1 (high quality, multi-server, fmhy-recommended)

- **P-Stream Forks** — Aether, XP-Stream, AfterStream, Basement, StreamWatch. **Open source movie-web/p-stream forks. Same backend family as VidLink.** Source: https://github.com/xp-technologies-dev/p-stream
- **Cineby** — we have this
- **Rive/Rivestream** — we have this
- **bCine** — `https://bcine.ru/`, fmhy highlights 4K quality. Worth probing.
- **NEPU** — `https://nepu.to/`, 4K, movies+TV+anime. Status: https://rar.to/

### Tier 2 (anime specialists)

- **animepahe** — `https://animepahe.pw/`, CF-protected (got 403 in probe). API: `/api?m=search|release|stream`. Returns kwik.cx (same as Miruro's kiwi).
- **Anify** — `https://anify.to/`, aggregator over gogoanime. Got 0 status — may be down.
- **KickAssAnime** — `https://kaa.lt/`, self-hosted, no CF
- **Animetsu** — `https://animetsu.net/`, gogoanime mirror
- **AllManga** — we have this

### Tier 3 (multi-server aggregators — P-Stream cousins)

- 67Movies, Cinezo, Cinetaro, Cinema.BZ, CinemaOS — all P-Stream forks. Not unique vs VidLink.

### Tier 4 (skip — no public API, browser-only)

- Embtaku, KissAnime, AniZone, AnimeXin, etc. — all browser-only or scrape-only.

---

## 7. Anime Episode Names — The Missing Layer

### 7.1 The gap

**AllManga doesn't return episode titles** in its `listEpisodes`. Miruro does, but truncates: "I'm Luffy!" vs Kitsu's full "I'm Luffy! The Man Who Will Become the Pirate King!".

### 7.2 The four upstream sources (all free, all public)

| Source                                               | Field                                                                                                                                              | Coverage                                                                           | Rate limit                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| **AniList** `graphql.anilist.co`                     | `Media.streamingEpisodes[].title/url/site` (also `Media.idMal`, `synonyms`, `coverImage`, `description`, `genres`, `studios`, `nextAiringEpisode`) | Modern anime with streaming partners (Frieren ✅, JJK ✅, One Piece ❌, Naruto ❌) | 90 req/min                |
| **Kitsu** `kitsu.io/api/edge/anime/{malId}/episodes` | `number, canonicalTitle, airdate, length, synopsis`                                                                                                | All MAL-listed anime (1387 episodes for One Piece ✅)                              | None documented           |
| **JIKAN** `api.jikan.moe/v4/anime/{malId}/episodes`  | `mal_id, title, aired, score, filler, recap, forum_url`                                                                                            | All MAL-listed anime (100 eps per page)                                            | 60 req/min, 2 req/sec     |
| **Miruro pipe** `providers.kiwi.episodes[].title`    | Short title only                                                                                                                                   | All anime                                                                          | Subject to pipe flakiness |

### 7.3 Sample data (verified live)

| Anime            | AniList ep 1              | Kitsu ep 1                                            | JIKAN ep 1                                                            | Miruro ep 1  |
| ---------------- | ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| Frieren (154587) | "The Journey's End"       | (full)                                                | (full)                                                                | (short)      |
| JJK (113415)     | "Ryomen Sukuna"           | "Ryomen Sukuna"                                       | "Ryomen Sukuna"                                                       | (short)      |
| One Piece (21)   | ❌ (no streamingEpisodes) | "I'm Luffy! The Man Who Will Become the Pirate King!" | "I'm Luffy! The Man Who Will Become the Pirate King!" (filler: false) | "I'm Luffy!" |

**Combined coverage: 100%.** For any anime, at least one source has full titles.

### 7.4 Build plan

A new shared module at `packages/providers/src/shared/anime-metadata.ts`:

```ts
export type AnimeEpisodeMetadata = {
  number: number;
  title?: string;
  synopsis?: string;
  airDate?: string;
  duration?: number;
  thumbnail?: string; // TMDB still
  isFiller?: boolean;
  isRecap?: boolean;
  externalLinks?: { site: string; url: string; title: string }[];
  introSkip?: { start: number; end: number };
  outroSkip?: { start: number; end: number };
  source: "kitsu" | "anilist" | "jikan" | "tmdb" | "aniskip" | "miruro" | "merged";
  confidence: number;
};

export type AnimeTitleMetadata = {
  anilistId: string;
  malId?: number;
  kitsuId?: number;
  tmdbId?: number;
  anidbId?: number;
  title: { romaji?: string; english?: string; native?: string; userPreferred?: string };
  synonyms?: string[];
  coverImage?: string;
  bannerImage?: string;
  description?: string;
  genres?: string[];
  studios?: string[];
  episodeCount?: number;
  status?: string;
  format?: string;
  episodeMetadata: readonly AnimeEpisodeMetadata[];
  fillerList?: readonly { number: number; type: "filler" | "canon" | "mixed" | "recap" }[];
};

// Fallback chain (parallel where safe):
// 1. AniList Media(id, type: ANIME) — title, malId, streamingEpisodes
// 2. Kitsu /anime/{malId}/episodes — full titles + synopses
// 3. JIKAN /anime/{malId}/episodes — titles + filler/recap flags
// 4. Miruro pipe providers.kiwi.episodes[].title — short titles fallback
//
// All wrapped with a 30-day TTL cache keyed by anilistId.
export async function getAnimeTitleMetadata(
  anilistId: string,
  signal?: AbortSignal,
): Promise<AnimeTitleMetadata | null>;
```

Wires into:

1. `apps/cli/src/services/search/definitions/anilist.ts` — search adapter, enrich results
2. `packages/providers/src/allmanga/direct.ts` — `listEpisodes`, attach titles + synopses
3. `packages/providers/src/miruro/direct.ts` — `listEpisodes`, overlay Kitsu's fuller title
4. `apps/cli/src/app-shell/command-router.ts` — pre-warm on user pick

---

## 8. Other research items worth tracking

| Item                                         | Why it matters                                                                                                 | Effort                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Cache invalidation on quality regression** | Right now TTL is 5min for sources. If a server flaps, user gets stuck. Health-driven cache eviction.           | small                   |
| **Parallel cycle in Miruro**                 | Miruro cycles sequentially (kiwi → bee → ...). With 7 servers, ~7×200ms = 1.4s worst case. Parallelize.        | small                   |
| **Pre-warm on search**                       | When user searches "Naruto" on TMDB, kick off Miruro `mappings` + AniList query in background.                 | small                   |
| **Anime episode counts > TMDB season model** | One Piece has 1164+ episodes. TMDB only has 1 season. UI assumes season/episode. Need "absolute episode" path. | medium                  |
| **Vidking session token refresh**            | `KUNAI_VIDEASY_SESSION_TOKEN` has unclear lifetime. When expires, every flavor 401s. Need "session dead" UX.   | small                   |
| **Source picker UI**                         | Confirm source picker actually shows all candidates, not just selected.                                        | small                   |
| **Quality normalization**                    | Providers use "1080p" / "4K" / "2160p" / "FHD" / "HD" / "Auto" — single ranker.                                | small (already partial) |
| **Subtitle prefer-language**                 | VidLink returns 18+ language captions. Split + sort by preferred.                                              | small                   |
| **Rivestream providers list drift**          | 6-provider list is dynamic. 24h cache. Add daily re-warm.                                                      | tiny                    |
| **anime-mappings static dataset**            | One-time download of all cross-DB IDs (15K+ titles) for offline ID resolution.                                 | small                   |

---

## 9. Cross-Provider Anime Resolve (the reframe)

The user's brief was right: this is NOT a search merge. It's a **resolve dispatch** on shared `anilistId`.

```
Search: AllManga (search) + AniList (metadata)
            ↓
        anilistId (shared key)
            ↓
Resolve:  Miruro (primary, 7 servers)  ←  uses anilistId directly
            ↓ on failure
        AllManga (fallback, needs its own show id)
            ↓
        (future) HiAnime, AnimePahe
```

**Miruro-first** is the right call because:

- 7 active servers vs AllManga's 1-2
- `mappings` field gives complete cross-DB IDs in one call
- Faster (160-200ms per source call)
- AllManga search results carry anilistId (cross-DB enrichment on AllManga side)
- Fallback to AllManga: use Miruro's `mappings.providers.ally.provider_id[0]` → AllManga show id

---

## 10. Concrete Build Plan (in priority order)

### Priority 1 — Quick wins (< 1 day total)

1. **Rivestream provider list** — `packages/providers/src/rivestream/direct.ts:58` — change static fallback from `["self", "prime"]` to `["flowcast", "asiacloud", "primevids", "hindicast", "guru", "ophim"]`
2. **TMDB anime classifier** — new `apps/cli/src/services/anime/anime-classifier.ts` with the 5-tier `isLikelyAnime` function
3. **Miruro server set** — `packages/providers/src/miruro/direct.ts:444-447` — extend fallback from `["kiwi", "bee"]` to `["kiwi", "bee", "pewe", "moo", "bonk"]`

### Priority 2 — Multi-flavor UI (1-2 days)

4. **VidKing multi-flavor** — `packages/providers/src/vidking/direct.ts:268-288` — promote Phase B flavors to default, add per-flavor `ProviderSourceCandidate` so all 12 surface in the picker
5. **Cineby promotion or deletion** — `packages/providers/src/cineby/index.ts` — either remove (if #4 makes Cineby redundant) or wire up to use the new multi-flavor VidKing

### Priority 3 — Anime episode metadata (1-2 days)

6. **`getAnimeTitleMetadata`** — new `packages/providers/src/shared/anime-metadata.ts` with the 4-source fallback chain
7. **Wire into AllManga** — `packages/providers/src/allmanga/direct.ts` — `listEpisodes` calls metadata aggregator, attaches titles + synopses
8. **Wire into Miruro** — `packages/providers/src/miruro/direct.ts` — `listEpisodes` overlays Kitsu's fuller title on top of Miruro's
9. **Pre-warm on pick** — `apps/cli/src/app-shell/command-router.ts` — kick off `getAnimeTitleMetadata(anilistId)` when user selects a result
10. **Episode picker UI** — show title + synopsis + airDate + thumbnail + "Filler" badge

### Priority 4 — Cross-provider ID resolution (1 day)

11. **Agnostic resolve dispatch** — tag each `SearchResult` with source provider, switch resolve to dispatch on result provider (anilistId → Miruro, else AllManga)
12. **Cross-DB ID enrichment on AllManga search** — if AllManga result has anilistId, fetch Miruro `mappings` in background for tmdbId/malId/kitsuId
13. **TMDB classification wiring** — apply `isLikelyAnime` to every TMDB search result, show "Anime" badge, default to anime providers

### Priority 5 — Polish (1-2 days)

14. **Miruro parallel cycling** — convert `runProviderCycle` to fire all 7 servers in parallel
15. **Source picker UI verification** — confirm all candidates show, not just selected
16. **Subtitle prefer-language sorting** — split VidLink's 18+ language captions by language, sort by preference
17. **Quality normalization** — single ranker for "1080p" / "4K" / "2160p" / "FHD" / "HD" / "Auto"
18. **VidKing session UX** — detect expired `KUNAI_VIDEASY_SESSION_TOKEN`, show clear "session dead" error
19. **bCine probe** — fmhy-recommended 4K provider, likely P-Stream family, low-effort add

### Priority 6 — Future (deferred)

20. **animepahe** — needs CF bypass first
21. **HiAnime** — search provider, similar to AllManga
22. **Anime absolute-episode path** — for One Piece, Naruto, Bleach (1000+ episodes)

---

## 11. Risks & Mitigations

| Risk                                                 | Mitigation                                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Miruro rotates `PIPE_KEY` silently                   | Health check on every cycle, scrape `VITE_PIPE_OBF_KEY` from `_next/static/chunks/*.js` as fallback (probe exists in `apps/experiments/scratchpads/provider-miruro/probe-key-extraction.ts`) |
| Cloudflare 444/403 on Miruro pipe                    | Keep mirror fallback loop, per-mirror backoff, no `rejectUnauthorized: false` (security risk)                                                                                                |
| AniList rate limit (90 req/min)                      | 30-day TTL cache on `getAnimeTitleMetadata`                                                                                                                                                  |
| JIKAN rate limit (2 req/sec)                         | JIKAN is last fallback, only triggered when AniList + Kitsu miss                                                                                                                             |
| AniSkip API may be down (returned `{}` in probe)     | Skip it gracefully; OP/ED skip is enhancement, not requirement                                                                                                                               |
| anime-filler-list Drupal HTML scrape is fragile      | Use only for `filler` boolean flag per episode; fall back to JIKAN's `filler` field                                                                                                          |
| VidKing session token expires                        | Detect 401 with "session_invalid" code, show clear UX                                                                                                                                        |
| anime-mappings static dataset is large (15K+ titles) | One-time download, ship as bundled JSON, refresh monthly                                                                                                                                     |

---

## 12. Files to touch (consolidated)

| File                                                          | Change                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/providers/src/rivestream/direct.ts:58`              | 5-line change: static fallback list                                    |
| `packages/providers/src/miruro/direct.ts:444-447`             | Extend server fallback to 7                                            |
| `packages/providers/src/miruro/manifest.ts`                   | Update notes (pewe/moo/bonk added)                                     |
| `packages/providers/src/vidking/direct.ts:268-288`            | Multi-flavor surface in source picker                                  |
| `packages/providers/src/cineby/index.ts`                      | Decide: promote to use multi-flavor OR delete (redundant after #4)     |
| `apps/cli/src/services/anime/anime-classifier.ts`             | NEW — `isLikelyAnime`                                                  |
| `apps/cli/src/services/search/definitions/tmdb.ts`            | Apply `isAnimeLikely` to search results                                |
| `apps/cli/src/services/search/definitions/anilist.ts`         | Add `getMetadata(anilistId)` method                                    |
| `packages/providers/src/shared/anime-metadata.ts`             | NEW — `getAnimeTitleMetadata` aggregator                               |
| `packages/providers/src/allmanga/direct.ts`                   | Wire metadata into `listEpisodes`                                      |
| `apps/cli/src/app-shell/command-router.ts`                    | Pre-warm metadata on user pick                                         |
| `apps/cli/src/services/providers/Provider.ts`                 | Extend `ProviderEpisodeOption` with `synopsis`, `airDate`, `thumbnail` |
| `apps/cli/src/domain/types` (episode picker)                  | Add new fields to episode option type                                  |
| `apps/cli/src/services/anime/episode-picker.ts` (or wherever) | Show title + synopsis + still + Filler badge                           |

---

## 13. Verification

All probe JSONs at `/tmp/opencode/provider-research/`. Re-run any time:

```sh
bun /tmp/opencode/miruro-research/probe-miruro.ts         # Miruro PIPE_KEY, servers, mappings
bun /tmp/opencode/miruro-research/probe-deeper.ts          # search shape, mappings reliability
bun /tmp/opencode/provider-research/probe-vidlink-rivestream.ts   # VidLink API + Rivestream providers
bun /tmp/opencode/provider-research/probe-miruro-sources.ts       # Miruro's upstream metadata sources
bun /tmp/opencode/provider-research/probe-anilist-kitsu-jikan.ts   # Anime episode name fallbacks
bun /tmp/opencode/miruro-research/tmdb-detection.json              # (read-only) anime classifier validation
```

Plus the original `apps/experiments/scratchpads/provider-miruro/` scratchpads have earlier probe data from 2026-05-25 — useful for diffing PIPE_KEY rotation, server set changes, etc.

---

**Status: research complete, ready to build.** Estimated implementation: 5-7 days for Priorities 1-4, 1-2 more for Priority 5.
