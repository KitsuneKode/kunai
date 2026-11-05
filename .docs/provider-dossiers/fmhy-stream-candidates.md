---
status: current
lastReviewed: "2026-11-05"
---

# FMHY stream candidates — reverse-engineering dossier

> Agent-facing (L3). Research for AnimePahe, Cinejoy, and P-Stream / Movie-Web forks.
> Live probes from 2026-11-05 (Asia/Kolkata lab). Kunai contract name is
> `CoreProviderModule` + `defineProviderManifest` — there is no `ProviderModuleV2`
> symbol in-tree.

## Request summary

- **Goal:** Replace deprecated aggregators (e.g. Videasy) and expand anime + TMDB lanes.
- **Sources:** FMHY videopiracy guide candidates — AnimePahe, Cinejoy, P-Stream forks.
- **Success criteria:** Actionable endpoints, headers, crypto/extraction steps, Kunai integration sketch.

---

## 1. AnimePahe

### 1.1 Domains and front door

| Role         | Observed hosts                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Primary site | `animepahe.com` → 301 → Cloudflare challenge (curl, 2026-11-05)                                                    |
| Mirrors      | `animepahe.si`, `animepahe.org`, `animepahe.ru`, `animepahe.pw` (community; same API shape historically)           |
| CDN / embed  | `kwik.cx`, `kwik.si`, `pahe.love` (rotate)                                                                         |
| Anti-bot     | Full Cloudflare on API from datacenter IPs; **expect curl-impersonate / user relay**, same class as HiAnime/Miruro |

**Evidence:** `curl -L https://animepahe.com/api?m=search&q=test` returned Cloudflare “Just a moment…” HTML, not JSON.

### 1.2 JSON API (stable contract across scrapers)

Base: `https://{mirror}/api`

| `m` param | Purpose                        | Key query params                            |
| --------- | ------------------------------ | ------------------------------------------- |
| `search`  | Title search                   | `q`, optional `l` (limit, e.g. 8)           |
| `release` | Paginated episode list         | `id` (anime id), `sort=episode_asc`, `page` |
| `links`   | Stream mirrors for one episode | `id`, `session`, `p=kwik`                   |

**Search response (documented shape):**

```json
{
  "total": 123,
  "data": [
    {
      "id": 0,
      "session": "uuid-like",
      "title": "One Piece",
      "poster": "https://…",
      "type": "TV",
      "episodes": 1000,
      "status": "Ongoing",
      "season": "Fall 1999",
      "year": 1999
    }
  ]
}
```

**Release response:** `data[]` with `episode`, `session`, `anime_id`, `created_at`, etc.; `last_page`, `per_page`, `total`.

**Links response (`p=kwik`):** `data` is an array of objects keyed by quality (`"720"`, `"1080"`, …). Each value includes:

- `kwik` / `kwik_adfly` — embed URL on `kwik.cx/e/{token}` (field name varies by mirror)
- Optional `audio` / `fansub` metadata in HTML-era scrapers

**Required headers (metadata API):**

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …
Referer: https://animepahe.com/
Accept: application/json
```

### 1.3 User flow

```text
search (m=search) → pick session/id
  → release pages (m=release) OR single-page when last_page=1
  → links (m=links&p=kwik) → kwik embed URL(s) by quality
  → fetch kwik page → unpack JS → direct MP4 and/or master .m3u8
  → playback with Referer https://kwik.cx/ (or embed host)
```

Episode pages on the site (`/play/{session}`) are optional; the API path above is what CLI tools use.

### 1.4 Kwik extraction (two families)

#### A. Dean Edwards `eval(function(p,a,c,k,e,d){…})` packer

Common on older kwik pages. Algorithm (from multiple open implementations — animdl, pahe-dl, anime-downloader):

1. Regex the packer tuple: `p, a, c, k, e, d`.
2. Rebuild dictionary `d` from `k.split('|')`.
3. Substitute identifiers in `p`, extract `https://…\.m3u8` or `https://…\.mp4`.

#### B. Form POST + custom alphabet decrypt

1. Load embed HTML; find params via regex like `("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)'`.
2. Run `decrypt(cipher, key, v1, v2)` over a custom base-N alphabet (`CHARACTER_MAP`).
3. Parse `<form action="…">` + hidden `token` input.
4. `POST` to action URL with `token` + `_token` cookie from Set-Cookie.
5. Follow redirect or parse returned HTML/JS for final URL.

**Operational constraints (community consensus):**

- Final `.m3u8` / signed MP4 URLs **expire in ~3–5 minutes** — cache embed URLs, not playback URLs (`ttlClass: stream-manifest`, short TTL).
- yt-dlp often fails on bare `kwik.cx` URLs; dedicated unpackers use Node/Bun `vm` or regex unpack, not generic extractors.

### 1.5 HLS vs direct MP4

| Format          | Typical origin                           | Kunai playback                                                      | Kunai download today                                                          |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| HLS master      | Kwik → vault/owocdn/ultracloud CDNs      | mpv + optional HLS relay (`apps/cli/src/infra/player/hls-relay.ts`) | **yt-dlp** with fragment concurrency (`DownloadService.executeYtDlpDownload`) |
| Progressive MP4 | Some kwik paths expose `.mp4` with Range | mpv direct                                                          | Still yt-dlp unless extended (see §4)                                         |

Miruro already documents kwik-adjacent CDN behavior: Bun fetch may 403 while mpv plays with `Referer: https://kwik.cx/` — probe with `verifyCandidateStream` using the **same headers** as playback.

### 1.6 Kunai fit

- **catalogIdentity:** `provider-native` (session UUID + numeric id), not AniList/TMDB-first.
- **Capabilities:** `search`, `episode-list`, `source-resolve`, `multi-source`, `quality-ranked`, optional `subtitle-resolve` if soft subs appear on CDN.
- **Relay:** metadata API only (`relaySafe: true`); stream URLs stay direct.
- **Shared code:** new `packages/providers/src/shared/kwik-unpack.ts`; CF layer reuses `curl-impersonate` from HiAnime client.

---

## 2. Cinejoy (`cinejoy.pk` / `cinejoy.to`)

### 2.1 Frontend

- **Stack:** SvelteKit PWA, ~150 obfuscated chunks, service worker, Plausible on `a.wing.st`.
- **Edge:** DDoS-Guard (`server: ddos-guard`, cookies `__ddg1_`, …) — not Cloudflare, but bot filtering still applies.
- **Routing:** SPA shell; deep links like `/watch/movie/{tmdbId}` hydrate client-side.

### 2.2 Plain JSON infrastructure (`api.wing.st`)

Live probe 2026-11-05:

**`GET https://api.wing.st/servers`**

Headers:

```http
Origin: https://cinejoy.pk
Referer: https://cinejoy.pk/
User-Agent: Mozilla/5.0 …
```

Response:

```json
{
  "servers": [
    { "name": "secret", "status": "ok", "language": "https://flagsapi.com/US/flat/64.png", "4k": true },
    { "name": "Nebula", "status": "ok", … },
    { "name": "Lisbon", "status": "ok", … },
    { "name": "Solara", "status": "ok", … },
    { "name": "Athens", "status": "ok", … }
  ]
}
```

**`GET https://api.wing.st/info?tmdb={id}&type={1|2}`**

- `type=1` movie, `type=2` TV
- Missing `type` → `{"error":"Invalid or missing type. Use 1 (movie) or 2 (tv)."}`
- With `type=1&tmdb=550` → upstream **502** at probe time (transient; treat as retryable)

**`GET https://subs.wing.st/subtitles?tmdb={id}`** (and TV variants with season/episode in community samples)

Response excerpt (Fight Club TMDB 550):

```json
{
  "total": 217,
  "subtitles": [
    {
      "id": "https://subs.wing.st/sub/{base64url…}",
      "language": "en",
      "url": "https://subs.wing.st/sub/…",
      "type": "srt",
      "display": "Fight.Club.….srt",
      "source": "shegu"
    }
  ]
}
```

Subtitle fetches are plain HTTP; Kunai can map to `SubtitleCandidate` + `buildDownloadStreamPolicy` for offline sidecars.

### 2.3 Encrypted stream gate — `POST https://api.wing.st/g`

Documented by independent reverse engineers (not fully reproduced here):

| Property | Detail                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method   | `POST`, body binary (`ArrayBuffer`)                                                                                                                                                                 |
| Magic    | Prefix bytes `02 02 04` on request framing                                                                                                                                                          |
| Crypto   | **`crush.wasm`** — per-request keys; response ciphertext                                                                                                                                            |
| Client   | Browser loads WASM from Cinejoy bundle; without WASM port, response is opaque                                                                                                                       |
| Legacy   | Older forks used `api.shegu.st` + `enc-dec.app` `/enc-cinejoy` / `/dec-cinejoy` (third-party decrypt service — **avoid shipping hard dependency** in Kunai; Vidlink pattern documents the tradeoff) |

**Rate limits / CORS:** JSON GET endpoints answered without browser CORS preflight from curl; `/g` is same-origin oriented (custom binary). No published rate-limit headers observed.

### 2.4 Playback headers (downstream)

Once decrypted, streams are typically **HLS** (.m3u8) on provider-scoped hosts. Expect:

```http
Referer: https://cinejoy.pk/
Origin: https://cinejoy.pk
User-Agent: modern Chrome UA
```

Exact hostnames rotate with server cluster (`Lisbon`, `Nebula`, …).

### 2.5 Kunai fit

- **catalogIdentity:** `tmdb`
- **Implementation tiers:**
  1. **Full:** Bun/WASM port of `crush.wasm` + `/g` request builder (high maintenance).
  2. **Pragmatic:** defer until WASM crypto is pinned with rotation canary tests (see Vidrock `VIDROCK_KEY_HEX` + `test/vidrock-crypto.test.ts` pattern).
- **Partial value without `/g`:** subtitle inventory + server list for UI prefetch; stream resolve blocked until crypto lands.
- **Do not** bake `enc-dec.app` as sole decryptor without TTL memo + explicit third-party failure class (Vidlink precedent).

---

## 3. P-Stream / Movie-Web fork ecosystem

### 3.1 Architecture pattern

Forks (`cinecat.eu`, `aether.st`, `streamux`, `rivestream.app`, `movy.sx`, …) share:

```text
TMDB id (+ season/episode)
  → site backend OR public API
  → scraper "lane" / "server" (UpCloud, VidCloud, Megacloud, Filemoon, …)
  → encrypted JSON or embed page
  → decrypt / unpack
  → HLS master and/or MP4 + WebVTT tracks
```

Open package: `@movie-web/providers` (VidBinge lineage) — modular scrapers for browser and server.

### 3.2 Kunai production overlap (already shipped)

| FMHY class                  | Kunai module                         | Mechanism                                                                               |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Rivestream-like aggregator  | `packages/providers/src/rivestream/` | `generateSecretKey(tmdbId)` + `GET /api/backendfetch` per service name                  |
| Movy / multi-scraper API    | `packages/providers/src/movy/`       | `api.wecollege.net/{lane}/sources` + `decryptMovyPayload` (XOR keystream, `mvm1` magic) |
| Vidrock-like AES-GCM API    | `packages/providers/src/vidrock/`    | Encrypted lane URLs in JSON; key from site bundle                                       |
| Vidlink / enc-dec bridge    | `packages/providers/src/vidlink/`    | TMDB id → enc-dec.app → vidlink.pro API                                                 |
| HiAnime (Megacloud lineage) | `packages/providers/src/hianime/`    | **ZokoAnime embed** XOR blob — not Megacloud `getSources` in resolve path               |

New forks should **extend lanes**, not duplicate — prefer one adapter per crypto family.

### 3.3 Megacloud / VidCloud / UpCloud (e1-player family)

**Embed URL pattern:**

```text
https://megacloud.tv/embed-{version}/e-1/{embedId}?k=1
```

**Sources XHR (ajax path varies by version):**

```http
GET https://megacloud.tv/embed-2/ajax/e-1/getSources?id={embedId}
Referer: https://megacloud.tv/
```

**Response (when authorized):**

```json
{
  "sources": [{ "file": "https://…", "type": "hls" }],
  "tracks": [{ "file": "https://….vtt", "label": "English" }]
}
```

Empty `sources` often means **missing decrypt headers**, stale embed id, or key rotation — not necessarily dead title.

**Decryption (2025 JS player — WASM replaced by obfuscated JS):**

1. `getSources` returns AES-CBC (or CryptoJS AES) ciphertext blob when encrypted mode is on.
2. Player script builds a **64-char hex key** from scattered string arrays + index permutation (documented in e1-player deobfuscator writeups).
3. Decrypt → JSON with `sources` + `tracks`.

**Key rotation:** pin CI vector like `packages/providers/test/rivestream-secret-key.test.ts` and Vidrock crypto canary; manifest `notes` must record recovery procedure.

**Filemoon:** largely removed from upstream anime scrapers (AllManga dossier: Filemoon lane gone); Movie-Web scrapers may still reference it — treat as opportunistic, often dead.

### 3.4 Rivestream secret key (concrete reference)

Already implemented — `generateSecretKey` in `rivestream/direct.ts`:

- Input: TMDB id (string or number)
- Salt: fixed `cArray[]` of 28 strings
- Output: base64-encoded hex digest chain (`hash2` + `o` mixers)

API call shape:

```http
GET https://www.rivestream.app/api/backendfetch?secretKey={key}&tmdbId={id}&type={movie|tv}&season={n}&episode={n}&service={apex|pulse|…}
Referer: https://www.rivestream.app/
```

401 → `cArray` or algorithm drift.

---

## 4. Kunai integration blueprint

### 4.1 Manifest + module (TypeScript)

Kunai uses `CoreProviderModule`:

```typescript
import { defineProviderManifest } from "@kunai/core";
import type { CoreProviderModule } from "@kunai/core";

export const animepaheManifest = defineProviderManifest({
  id: "animepahe",
  displayName: "AnimePahe",
  domain: "animepahe.com",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "provider-native",
  capabilities: ["search", "episode-list", "source-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["search", "list-episodes", "resolve-stream", "health-check"],
      browserSafe: false,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", "animepahe", "title", "episode", "quality", "source"],
    allowStale: false, // kwik URLs expire quickly
  },
  browserSafe: false,
  relaySafe: true,
  relayProfile: { upstreamHosts: ["animepahe.com", "kwik.cx"] },
});

export const animepaheProviderModule: CoreProviderModule = {
  providerId: "animepahe",
  manifest: animepaheManifest,
  search: searchAnimepahe,
  listEpisodes: listAnimepaheEpisodes,
  resolve: resolveAnimepahe,
};
```

Register in `apps/cli/src/container/bootstrap-providers.ts` only when production-ready.

### 4.2 Resolve pseudo-code (AnimePahe + cycle runner)

For multi-quality / multi-CDN, mirror **Movy** (`runProviderCycle`) or **HiAnime** (single server, multi-variant):

```typescript
async function resolveAnimepahe(input, ctx): Promise<ProviderResolveResult> {
  const { nativeId, episode } = requireProviderNativeEpisode(input);
  const links = await paheJson(ctx, {
    m: "links",
    id: nativeId.animeId,
    session: nativeId.session,
    p: "kwik",
  });
  const candidates = flattenKwikLinks(links.data); // 720, 1080, …

  return runProviderCycle({
    providerId: "animepahe",
    candidates: candidates.map((c) => ({
      id: `kwik:${c.quality}`,
      probe: async () => {
        const target = await unpackKwikEmbed(ctx, c.embedUrl); // mp4 or m3u8
        return verifyCandidateStream(ctx, {
          url: target.url,
          protocol: target.protocol,
          headers: { Referer: "https://kwik.cx/", "User-Agent": PAHE_UA },
        });
      },
    })),
    // … trace + inventory finalize per movy/hianime
  });
}
```

**Non-negotiable:** every success path goes through `verifyCandidateStream` with the probed URL object.

### 4.3 Cinejoy module sketch

```typescript
async function fetchCinejoyPayload(tmdbId, kind, server, ctx): Promise<DirectStreamPayload | null> {
  await assertCatalogPresent(tmdbId, kind); // GET /info
  const binary = buildGRequestBody({ tmdbId, kind, server }); // WASM port
  const res = await providerFetch(ctx, "https://api.wing.st/g", {
    method: "POST",
    headers: {
      Origin: CINEJOY_ORIGIN,
      Referer: CINEJOY_REFERER,
      "Content-Type": "application/octet-stream",
    },
    body: binary,
  });
  const plain = await decryptCrushResponse(await res.arrayBuffer());
  return mapToDirectStreamPayload(plain);
}
```

Wire through `resolveDirectStreamSource` (`packages/providers/src/shared/direct-stream-source.ts`) once plaintext JSON matches `DirectStreamPayload`.

### 4.4 Download service improvements (`apps/cli/src/services/download/`)

**Today:** all video artifacts go through **`executeYtDlpDownload`**; subtitles alone use `fetchGuardedStreamTarget` + atomic write.

**Recommended fast path for direct MP4:**

1. After resolve, if `stream.protocol === "progressive"` (or URL ends with `.mp4` and probe `Content-Type` is `video/mp4`) and `Content-Length` is known:
   - Stream copy via existing `copyToReservedFile` / `readBoundedBody` pattern (same as publication path post-yt-dlp).
   - Pass `buildDownloadStreamPolicy(job.headers)` on every Range request; parallel Range workers optional.
2. Fall back to yt-dlp when:
   - HLS/DASH (`protocol: hls` / manifest URL)
   - AES-128 or separate audio renditions
   - Probe fails or URL expires mid-job (retry with re-resolve hook)
3. Persist **`streamExpiresAt`** in job metadata when provider signals short TTL (AnimePahe/Kwik).
4. Expose **`downloadStrategy: "direct-copy" | "yt-dlp"`** in diagnostics for support.

This avoids yt-dlp overhead for Pahe MP4 while keeping one code path for fragmented streams.

---

## 5. Sample regression cases

| Provider   | Case                     | Expect                                         |
| ---------- | ------------------------ | ---------------------------------------------- |
| AnimePahe  | One Piece TV, ep 1, 720p | JSON links → kwik → playable with kwik Referer |
| AnimePahe  | CF block from lab IP     | Structured `blocked` / curl fallback trace     |
| Cinejoy    | TMDB 550 movie           | `/subtitles` non-empty; `/g` decrypt → HLS     |
| Cinejoy    | Server failover          | Lisbon 502 → retry Nebula                      |
| Megacloud  | HiAnime embed id         | Non-empty `sources` after key extract          |
| Rivestream | TMDB 550                 | citadel/apex lane 200 with valid secretKey     |

---

## 6. Risks and drift watchlist

| Surface    | Likely break              | Detection                                |
| ---------- | ------------------------- | ---------------------------------------- |
| AnimePahe  | CF + mirror domain        | `test:live` probe search JSON            |
| Kwik       | Packer → POST token swap  | Golden HTML fixtures in unit tests       |
| Kwik       | CDN 403 on fetch vs mpv   | resolve-gate with player headers         |
| Cinejoy    | `crush.wasm` swap         | WASM hash pin + canary TMDB id           |
| Cinejoy    | `api.wing.st` 502 bursts  | endpoint health + retry                  |
| Megacloud  | e1-player key permutation | pinned decrypt vector                    |
| Rivestream | `cArray` edit             | existing `rivestream-secret-key.test.ts` |
| Movy       | seed XOR / lane 404       | existing movy lane sweep                 |

---

## 7. Implementation handoff

- **Reuse:** `runProviderCycle`, `verifyCandidateStream`, `resolveDirectStreamSource`, curl-impersonate stack, HLS ladder expansion, `buildDownloadStreamPolicy`.
- **New shared:** `kwik-unpack.ts`, optional `crush-wasm` runtime (Cinejoy only).
- **Do not assume:** TMDB coverage for AnimePahe; enc-dec.app availability; Filemoon uptime; bare `fetch` through Cloudflare without relay/curl.
- **Production gate:** `loadProductionProviderModules()` explicit opt-in per AGENTS.md.
