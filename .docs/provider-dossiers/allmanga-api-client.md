# AllManga-Compatible API Client Provider Dossier

- **Status:** production
- **Provider ID:** allanime today; intended display/runtime naming is AllManga-compatible until the config/provider ID rename is completed.
- **Domain:** allmanga.to / api.allanime.day / allanime.day
- **Supported content:** anime
- **Runtime class:** node fetch (0-RAM)
- **Search support:** Yes, native GraphQL.
- **Episode/catalog support:** Yes, native GraphQL via `availableEpisodesDetail`.
- **Stream resolution path:** Two-tier request (GET persisted query → fallback POST), then hex-decodes source paths + AES-256-CTR decrypts `tobeparsed` blob, extracts wixmp/m3u8 embed links.
- **Quality/source inventory behavior:** Provides multiple qualities in the decrypted payload.
- **Header/referrer/user-agent requirements:** GET tier uses `youtu-chan.com` Origin/Referer; POST fallback uses `allmanga.to` Referer.
- **Cache key and TTL recommendations:** 2 hours for streams, 24h for catalog, 45s in-memory TTL for episode-detail dedup.
- **Known failure modes:** GraphQL endpoint rotation, AES key rotation, Cloudflare challenge on direct POST.
- **What is proven in production code:** Reliable AES decryption and GraphQL querying in `packages/providers/src/allmanga/api-client.ts`.
- **What is only proven in experiments:** N/A.
- **Minimum tests/fixtures needed before Provider SDK promotion:** AES decryption and episode-string parity tests.

## Ani-CLI Parity

Current parity target: **ani-cli commit `6803b8a`** (May 1 2026).

| Feature                                              | ani-cli   | kitsunesnipe                        | Sync |
| ---------------------------------------------------- | --------- | ----------------------------------- | ---- |
| AES key `Xot36i3lK3:v1`                              | `766795b` | Hardcoded                           | ✅   |
| AES blob format (skip 1 + IV 12 + ct_len-16-13)      | `766795b` | `decodeTobeparsed`                  | ✅   |
| Persisted query hash `d405d0edd...`                  | `6803b8a` | GET tier in `resolveEpisodeSources` | ✅   |
| Two-tier GET→POST for episode sources                | `6803b8a` | `resolveEpisodeSources`             | ✅   |
| `Origin: youtu-chan.com` on GET tier                 | `6803b8a` | `resolveEpisodeSources`             | ✅   |
| `allmanga.to` referer for POST/search/listing        | `6803b8a` | `direct.ts` + `allanime.ts` config  | ✅   |
| Filemoon AES-256-CTR decryption                      | `6803b8a` | `fetchFilemoonLinks`                | ✅   |
| Sources: Default / Yt-mp4 / S-mp4 / Luf-Mp4 / Fm-mp4 | `6803b8a` | `KNOWN_SOURCES` set                 | ✅   |
| Provider URL hex decode (83-char table)              | `6803b8a` | `hexDecode`                         | ✅   |
| `/clock` → `/clock.json` rewrite                     | `6803b8a` | `hexDecode`                         | ✅   |
| Search GraphQL + countryOrigin:"ALL"                 | `6803b8a` | `gqlPost`                           | ✅   |

When AllAnime/AllManga breaks:

1. Compare behavior with local ani-cli checkout at `~/Projects/osc/ani-cli`
2. Check if the break is shared upstream or Kunai-specific
3. If shared upstream, implement the smallest temporary local fix and document divergence

## Two-Tier Request Strategy

The episode source URL fetch uses a two-tier approach to bypass Cloudflare/anti-bot:

**Tier 1 — GET (primary):**

```
GET https://api.allanime.day/api?variables={...}&extensions={"persistedQuery":{"version":1,"sha256Hash":"d405d0edd..."}}
Referer: https://youtu-chan.com
Origin: https://youtu-chan.com
User-Agent: Mozilla/5.0 (...)
```

The persisted query hash is `d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec` (SHA-256 hash of a specific GraphQL query variant stored server-side).

Variables are `encodeURIComponent`-encoded JSON. The API returns either:

- `{"data":{"episode":{"episodeString":"1","sourceUrls":null},"tobeparsed":"<base64_blob>"}}` → encrypted
- A non-tobeparsed plaintext response → unencrypted (but rare)

**Tier 2 — POST (fallback):**

```
POST https://api.allanime.day/api
Content-Type: application/json
Referer: https://allmanga.to
Body: {"query":"...","variables":{"showId":"...","translationType":"sub|dub","episodeString":"..."}}
```

Falls back to full-query POST only when the GET tier returns empty or no `tobeparsed` field.

## AES-256-CTR Decryption (`decodeTobeparsed`)

The `tobeparsed` blob format:

| Offset | Size     | Content                    |
| ------ | -------- | -------------------------- |
| 0      | 1 byte   | Version (expected: `0x01`) |
| 1      | 12 bytes | IV (counter prefix)        |
| 13     | ct_len   | Ciphertext                 |
| end-16 | 16 bytes | Auth tag (discarded)       |

Counter = IV bytes (12) + `00 00 00 02` (4 bytes). AES-CTR with 64-bit counter length.

Key = SHA-256(`"Xot36i3lK3:v1"`) — 32 bytes.

## Source Names (`KNOWN_SOURCES`)

| Source Name | Provider   | Content Type               | Implemented             |
| ----------- | ---------- | -------------------------- | ----------------------- |
| `Default`   | wixmp      | m3u8 (multi) → mp4 (multi) | ✅                      |
| `Yt-mp4`    | youtube    | mp4 (single)               | ✅                      |
| `S-mp4`     | sharepoint | mp4 (single)               | ✅                      |
| `Luf-Mp4`   | hianime    | m3u8 (multi)               | ✅                      |
| `Fm-mp4`    | filemoon   | m3u8 (single)              | ✅ `fetchFilemoonLinks` |

## Subtitle Resolution

- **Current production subtitle behavior:** Subtitles are typically hard-coded (HardSub) or provided in the m3u8 playlist.
- **Experimental/research subtitle findings:** No external API required.
- **Exact endpoint or network pattern if known:** Embedded in stream manifest.
- **Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct .vtt/.srt, or are missing:** Provider payload / Embedded in stream.
- **Language matching rules:** Uses sub/dub GraphQL translation type.
- **SDH/hearing-impaired filtering recommendation:** N/A (handled upstream).
- **CLI/mpv format preference:** Native m3u8 handling.
- **Future web format preference:** Native m3u8 handling.
- **Whether subtitle fetch can happen before playback starts:** No, tied to stream.
- **Whether subtitle resolution needs Playwright or can be 0-RAM fetch:** 0-RAM fetch.
- **Subtitle list cache TTL recommendation:** 2 hours (tied to stream).
- **Failure modes:** HardSubs cannot be turned off.
- **Exact production gap:** Cannot inject custom font styling for HardSubs.
- **Minimum production fix needed:** UI indicator showing if stream is HardSub.
- **Tests/fixtures needed before claiming subtitle support works:** Test GraphQL query for sub/dub and HLS subtitle track exposure.
