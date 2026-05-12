# Miruro Provider Dossier

- **Status:** candidate
- **Provider ID:** miruro
- **Domain:** www.miruro.tv / theanimecommunity.com
- **Supported content:** anime
- **Runtime class:** node fetch (0-RAM) with XOR+ gzip decryption
- **Search support:** Yes, via miruro pipe API.
- **Episode/catalog support:** Yes, via miruro pipe API.
- **Stream resolution path:** miruro pipe API (`/api/secure/pipe?e=base64url`) with XOR decryption, key `71951034f8fbcf53d89db52ceb3dc22c`.
- **Header/referrer/user-agent requirements:** `Referer: https://www.miruro.tv/`, Chrome User-Agent required by CDN.
- **Cache key and TTL recommendations:** 2 hours for streams, 24h for catalog.
- **Known failure modes:** Cloudflare JS challenge on `miruro.tv` (rate limits), Cloudflare JS challenge on `theanimecommunity.com/api/v1/episodes/{id}/{ep}` (backend source endpoint).
- **What is proven in production code:** Backend bypass attempt (direct theanimecommunity.com API) — first endpoint works (`mediaItemID`), second endpoint CF-blocked.
- **What is only proven in experiments:** Pipe API with XOR/gzip decryption for episodes listing. Sources retrieval via pipe API intermittently works (blocked by CF rate limiting).
- **Minimum tests/fixtures needed before Provider SDK promotion:** XOR decrypt fixture tests, rate-limit recovery tests, pipe API end-to-end test.

## Two-Phase Resolution Strategy

### Phase 1: Backend Bypass (current production)

**Endpoint:** `theanimecommunity.com/api/v1/episodes/mediaItemID?AniList_ID={id}&mediaType=anime&episodeChapterNumber={ep}`

- Returns `{"mediaItemID": 569}` — works without Cloudflare issues
- **Source fetch:** `theanimecommunity.com/api/v1/episodes/{mediaItemID}/{episode}` — **ALWAYS returns Cloudflare JS challenge**. All header variations failed testing (different User-Agent, Accept, Referer, Origin, sec-\* headers, query-parameter format).

**Verdict:** Backend bypass is partially broken. The source endpoint is CF-protected and unreachable via plain HTTP. No amount of header tweaking fixes it.

### Phase 2: Pipe API (recommended approach)

**Endpoint:** `https://www.miruro.tv/api/secure/pipe?e={base64url-payload}`

**Request construction:**

1. Build JSON payload:
   ```json
   {"path": "<endpoint>", "method": "GET", "query": { ... }, "body": null, "version": "0.2.0"}
   ```
2. Base64url-encode (standard base64, then replace `+/` with `-_`, strip `=` padding)
3. Append as `?e=` parameter

**Decryption (XOR + optional gzip):**

1. Check for `bh4YNPj7` prefix or `x-obfuscated: 2` response header
2. Base64url-decode the response body
3. XOR-decrypt with hex key `71951034f8fbcf53d89db52ceb3dc22c` (rolling XOR, each byte XOR'd with key byte at `i % 32`)
4. If first two decrypted bytes are `0x1F 0x8B` (gzip magic), decompress with gzip
5. JSON.parse the result

**Known pipe endpoints:**

| Path       | Query                                            | Response Format                                                                     |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `search`   | `q`, `limit`, `offset`, `type` ("ANIME")         | Array of anime results                                                              |
| `episodes` | `anilistId`                                      | `{ mappings, providers: { kiwi: { meta, episodes: { sub: [...], dub: [...] } } } }` |
| `sources`  | `episodeId`, `anilistId`, `provider`, `category` | `{ sources: { [provider]: [...] }, headers, subtitles? }`                           |

**Episode ID format:** From `kiwi.episodes.sub[0].id` — base64-encoded string like `"YW5pbWVwYWhlOjMyMDU6MjI0OTc6MQ"`. Use this as `episodeId` in the sources pipe.

**Source response format:** Each source entry has: `url`, `quality`, `type` ("hls"/"embed"), `referer`.

**Known issues with pipe API:**

1. Cloudflare rate limiting — after ~3-5 requests in quick succession, Bun's fetch gets `ECONNRESET`. The episodes endpoint works reliably for the first request but may fail after repeated calls.
2. Sources endpoint returns `HTTP 444` (Cloudflare "no response") intermittently — likely because the pipe proxies to the same CF-blocked theanimecommunity.com backend.
3. `curl` with `--tls-max 1.2` has a different success rate than Bun's fetch due to TLS fingerprint differences.

## Implementation Guidelines

1. **Always use the pipe API, not the backend bypass**, for episode listing and source retrieval.
2. **Implement exponential backoff retry** (at least 3 retries with 1s, 2s, 4s delays) to handle CF rate limiting.
3. **Cache episode listings aggressively** (24h TTL) to minimize pipe API calls.
4. **Use `ProviderFetchPort` with AbortSignal timeout** (15s) to avoid hanging on blocked requests.
5. **Fall back to other providers** (allanime, rivestream) when miruro fails after retries.
6. **Preview XOR + gzip decryption** — already ported in `miruro-decrypt.ts` experiment. The decryption is deterministic and well-understood.

## Known Gaps

| Gap                           | Status                                               |
| ----------------------------- | ---------------------------------------------------- |
| XOR decrypt + gzip decompress | Available in experiments (`miruro-decrypt.ts`)       |
| Pipe API episode listing      | Proven (episodes endpoint works)                     |
| Pipe API sources              | Intermittently works (CF rate limits)                |
| Rate limit handling           | Not implemented — need retry with backoff            |
| Cookie/CF clearance reuse     | Not explored — potential to improve reliability      |
| Subtitle extraction           | Untested — sources response may contain subtitles    |
| Provider selection            | kiwi, arc, dune, hop, bee — need to test which works |
