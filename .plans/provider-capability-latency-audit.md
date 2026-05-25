# Provider Capability and Latency Audit

**Branch:** `research/provider-capability-latency-audit`
**Date:** 2026-05-25
**Method:** Offline code + deterministic fixtures + `apps/experiments` scratchpads. Follow-up live/browser probes were run on 2026-05-25 for Miruro and AllManga identity/source-shape verification.

This audit re-validates an earlier draft on the same branch. **Code and fixtures are truth** when docs or experiment reports disagree.

## 0. 2026-05-25 follow-up: AllManga and Miruro

### AllManga root cause

The failing Solo Leveling anime benchmark is not a latency problem. It is a source-shape drift:

- Correct Season 1 identity is AllManga id `B6AMhLy6EQHDgYgBF`, AniList `151807`, search index `1`.
- Decoded episode sources are `Ak` and `S-mp4`.
- `S-mp4` returns an mp4-shaped response without a usable `link`.
- `Ak` returns a DASH-style payload with `rawUrls.vids[]`, `rawUrls.audios[]`, `duration`, and subtitles.
- Kunai currently skips `Ak`, so it reports no streams.

Do not patch this by returning a video-only URL. The correct next step is an experiment-only MPD/EDL proof that combines one video representation with one audio representation, then a provider contract implementation if mpv playback is proven.

### Miruro root cause

The earlier Miruro failure was not a permanent provider outage. Current evidence:

- Browser pipe harvest succeeded for 8/9 Miruro steps.
- Solo Leveling S1E1 direct bench now succeeds:
  - `list=734ms`
  - `resolve=153ms`
  - `manifest=230ms`
  - `mpv=2982ms`
  - `host=vault-06.uwucdn.top`
- Some stream-shaped candidates still return 403, especially direct `kwik.cx` candidates.
- Production currently assumes mostly `kiwi`/`bee`, but live episode payloads include broader provider keys such as `ANIMEKAI`, `ANIMEZ`, `hop`, `ZORO`, `ally`, and `dune`.

The correct next step is generalized provider-key inventory and source-health ranking, not Playwright in production.

---

## 1. Executive summary

### Production scope (engine-registered)

`apps/cli/src/container.ts` registers four direct providers:

| Provider id  | Package module                                | Default for          |
| ------------ | --------------------------------------------- | -------------------- |
| `allanime`   | `packages/providers/src/allmanga/*`           | Anime                |
| `vidking`    | `packages/providers/src/vidking/direct.ts`    | Movies / TV          |
| `rivestream` | `packages/providers/src/rivestream/direct.ts` | Fallback (movies/TV) |
| `miruro`     | `packages/providers/src/miruro/direct.ts`     | Anime fallback       |

**Not in the production engine:** `cineby` (`packages/providers/src/cineby/index.ts`, manifest `status: "research"`). Cineby is a VidKing/Videasy **flavor wrapper** for experiments and future promotion—not a fifth runtime adapter today.

### Highest-confidence wins (zero or low extra upstream cost)

1. **Miruro intro/outro timing (zero network cost):** Pipe `sources` payloads include `intro` / `outro` (`packages/providers/test/fixtures/miruro/source-response.json`). This is now preserved on `StreamCandidate.metadata`, and the CLI merges provider-native timing into playback timing after stream resolution. IntroDB/AniSkip remain the external timing sources, but Miruro can now supply a zero-extra-call fallback for autoskip.

2. **VidKing failure-path latency:** Per-server `tryVidkingServer` loops query variants (with year when present) × `context.retryPolicy.maxAttempts` (default 2). HTTP **404 is retryable** (`retryable: response.status !== 401 && response.status !== 403`). `runProviderCycle` tries up to **4 direct servers**, then up to **4 embed-referer servers** if embed URL can be built. Worst-case Videasy HTTP count per full exhaust: **(4 + 4) servers × 2 query variants × 2 attempts = up to 32** sequential calls (not 16).

3. **Rivestream services list (one RTT per cold resolve):** Every resolve blocks on `VideoProviderServices` before cycling `self` / `prime` (etc.). `secretKey` is memoized per TMDB id; **services list is not**.

4. **Miruro episode titles in `listEpisodes` (zero network cost when episodes cache hits):** `fetchMiruroEpisodeCatalog` already maps `entry.title` into labels (`Episode N · {title}`). The 2026-05-20 `episode-metadata-audit` report saying Miruro titles are “not wired” is **stale** relative to current `miruro/direct.ts`.

### Corrections vs the prior draft on this branch

| Prior claim                            | Verified truth                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Add Wyzie to VidKing direct resolver” | **Misplaced.** Active Wyzie path is `apps/cli/src/subtitle.ts` (`resolveSubtitlesByTmdbId`) + **late subtitle lookup** in `PlaybackPhase` when the stream has no provider subtitles. Key in production: `wyzie-4e88cddcd20e4d3e9a390625e66a290c` (not the experiment key `wyzie-9bafe78d95b0ae85e716d772b4d63ec4`). |
| “Cineby is an active provider”         | **Research-only** wrapper; not in `createProviderEngine` modules.                                                                                                                                                                                                                                                   |
| “VidKing worst case = 16 HTTP calls”   | **Undercounted** when embed-referer tier runs; see math above.                                                                                                                                                                                                                                                      |
| “Rivestream has no subtitles”          | **Wrong.** `captions` in source envelope are normalized to `SubtitleCandidate[]` in `rivestream/direct.ts`.                                                                                                                                                                                                         |
| “AllManga double GraphQL only”         | **Incomplete.** Cold resolve also does persisted-query GET + POST fallback for episode sources, parallel per-source link fetches on `allanime.day`, and optional `fetchM3u8Variants` for master playlists.                                                                                                          |

---

## 2. Architecture and call-path map (offline)

```text
PlaybackResolveCoordinator / PlaybackResolveWorkService
  -> cache / inventory / health (StreamHealthService)
  -> ProviderEngine.resolve(providerId)
       -> runProviderCycle (sequential candidates, maxAttemptsPerCandidate)
            -> provider direct.ts resolveCandidate
  -> providerResolveResultToStreamInfo
  -> PlaybackPhase: timing (IntroDB + AniSkip), late Wyzie (TMDB series/movie only)
  -> PersistentMpvSession
```

**Budget lanes (from existing engine behavior):**

- **Blocking foreground:** provider resolve inside play path.
- **Near-need / background:** IntroDB, AniSkip, late Wyzie, prefetch resolve work.
- **Cached / joined:** Miruro episode list (30m), Miruro sources (5m), AllManga show catalog (45s), AllManga episode sources, Rivestream secretKey per tmdbId.

---

## 3. Capability and request-cost matrix

Confidence: **Known** = code or fixture; **Suspected** = experiment report only; **Unknown** = needs approved live check.

### Miruro (`miruro`)

| Capability       | Available evidence      | Preserved today                  | User surface             | Extra calls | Lane | Recommendation                        | Conf. |
| ---------------- | ----------------------- | -------------------------------- | ------------------------ | ----------- | ---- | ------------------------------------- | ----- |
| Source inventory | kiwi / bee              | Yes                              | Source picker            | None        | —    | Maintain                              | Known |
| Quality variants | HLS qualities in pipe   | Yes                              | Quality                  | None        | —    | Maintain                              | Known |
| Audio sub/dub    | category + server       | Yes                              | Labels                   | None        | —    | Maintain                              | Known |
| Soft subtitles   | bee `subtitles[]`       | Yes                              | Sub picker               | None        | —    | Maintain                              | Known |
| Hardsub          | kiwi profile            | Yes                              | Labels                   | None        | —    | Maintain                              | Known |
| Poster/artwork   | search via AniList path | Partial                          | Search                   | None        | —    | Maintain                              | Known |
| Seek thumbnails  | `thumbnails[]`          | Yes (`artwork.seekBarVttUrl`)    | Diagnostics / future mpv | None        | —    | Wire to player if supported           | Known |
| Intro/outro      | pipe `intro`/`outro`    | Yes (`StreamCandidate.metadata`) | Auto-skip                | None        | —    | Maintain provider-native timing merge | Known |
| External IDs     | AniList                 | Yes                              | Routing/cache            | None        | —    | Maintain                              | Known |
| Episode names    | pipe episode `title`    | Yes in `listEpisodes`            | Episode picker           | None        | —    | Maintain (fix stale docs)             | Known |
| Expiry/headers   | per-stream referer      | Yes                              | mpv                      | None        | —    | Maintain                              | Known |
| Failure/health   | cycle + network class   | Yes                              | Diagnostics              | None        | —    | Maintain                              | Known |

**Cold resolve request budget (Known):** 1× `episodes` pipe (+ cache) + up to 4× `sources` pipe (sub/dub × kiwi/bee cycle) before success.

### VidKing (`vidking`)

| Capability       | Available evidence             | Preserved today            | User surface    | Extra calls                 | Lane       | Recommendation                             | Conf.     |
| ---------------- | ------------------------------ | -------------------------- | --------------- | --------------------------- | ---------- | ------------------------------------------ | --------- |
| Source inventory | 4 Videasy servers + embed tier | Yes                        | Source picker   | 0–32 HTTP on exhaust        | Blocking   | Trim variants/404 retry                    | Known     |
| Quality variants | payload `sources`              | Yes                        | Quality         | None                        | —          | Maintain                                   | Known     |
| Soft subtitles   | payload                        | Often empty                | Sub picker      | Wyzie via **app** late path | Background | Document; don’t duplicate in provider pkg  | Known     |
| Seek thumbnails  | dossier claims HLS IMAGE       | **Not** in direct resolver | —               | Manifest parse?             | Defer      | **Suspected** — not in `vidking/direct.ts` | Suspected |
| Intro/outro      | —                              | No                         | AniSkip/IntroDB | External                    | Background | No provider facts                          | Known     |
| TMDB IDs         | required                       | Yes                        | Internal        | None                        | —          | Maintain                                   | Known     |

### Rivestream (`rivestream`)

| Capability       | Available evidence    | Preserved today | User surface   | Extra calls              | Lane       | Recommendation           | Conf. |
| ---------------- | --------------------- | --------------- | -------------- | ------------------------ | ---------- | ------------------------ | ----- |
| Source inventory | dynamic services list | Yes             | Source picker  | **+1** services GET/cold | Blocking   | **Cache services** (TTL) | Known |
| Soft subtitles   | `captions`            | Yes             | Sub picker     | Included in source GET   | Blocking   | Maintain                 | Known |
| Intro/outro      | —                     | No              | IntroDB (TMDB) | External                 | Background | N/A for anime            | Known |

**Cold resolve (Known):** 1× services + 1× source request per candidate tried (typically 1–2 providers).

### AllAnime / AllManga (`allanime`)

| Capability          | Available evidence       | Preserved today            | User surface  | Extra calls                                                     | Lane     | Recommendation                 | Conf. |
| ------------------- | ------------------------ | -------------------------- | ------------- | --------------------------------------------------------------- | -------- | ------------------------------ | ----- |
| Source inventory    | FM-HLS / VID-MP4 / wixmp | Yes                        | Source picker | 1 catalog GQL (+ fallback) + episode GQL GET/POST + N link APIs | Blocking | Cache referer outcome          | Known |
| Poster/thumbnail    | GQL `thumbnail`          | Yes                        | Search/browse | In catalog query                                                | —        | Maintain                       | Known |
| Episode list labels | episode id strings only  | **Generic** `Episode {id}` | Picker        | None                                                            | —        | Richness gap (no names in API) | Known |
| MAL/AniList         | catalog GQL              | Yes                        | AniSkip path  | In catalog                                                      | —        | Maintain                       | Known |
| Soft subtitles      | link payload             | Yes                        | Sub picker    | With link fetch                                                 | Blocking | Maintain                       | Known |
| Hardsub             | sub mode                 | Yes                        | Labels        | None                                                            | —        | Maintain                       | Known |

### Cineby (`cineby`) — research only

| Capability           | Available evidence                               | Preserved today         | User surface | Extra calls                       | Lane   | Recommendation                                       | Conf. |
| -------------------- | ------------------------------------------------ | ----------------------- | ------------ | --------------------------------- | ------ | ---------------------------------------------------- | ----- |
| Multi-flavor Videasy | `CINEBY_FLAVORS` + `resolveVidkingDirect`        | In research module only | N/A          | Same as VidKing per flavor        | —      | Promote only after live gate; inherits VidKing fixes | Known |
| Experiments          | `apps/experiments/scratchpads/provider-cineby/*` | N/A                     | N/A          | Playwright sniff (not production) | Manual | Use for endpoint discovery, not runtime              | Known |

**Experiment notes (Cineby):** Scratchpads document Videasy multi-server shapes, decrypt pipelines, multi-audio sniff (`cineby-multi-audio.json`), and VidKing embed parity—aligned with promoting **flavor labels** without a separate backend.

---

## 4. Playback request-economy matrix

| Scenario                    | Cache      | Inventory | Health              | Provider resolves                         | Catalog                                    | Manifest / link  | Optimization                                                   |
| --------------------------- | ---------- | --------- | ------------------- | ----------------------------------------- | ------------------------------------------ | ---------------- | -------------------------------------------------------------- |
| Fresh exact cache hit       | 1 SQLite   | 0         | 0–1 if stale policy | 0                                         | 0                                          | 0                | Keep zero-work path                                            |
| Inventory selection         | 0          | 1         | 0                   | 0                                         | 0                                          | 0                | Keep                                                           |
| Cold play — VidKing         | 1 miss     | 0         | 0                   | 1× cycle (1–8 servers × internal retries) | 0                                          | 0                | 404 non-retry; skip year variant when `tmdbId` set             |
| Cold play — Miruro          | 1 miss     | 0         | 0                   | 1–5 pipe calls                            | 0                                          | 0                | Source cache keyed by episode+server+audio                     |
| Cold play — Rivestream      | 1 miss     | 0         | 0                   | 1 + N providers                           | 0                                          | 0                | Cache `VideoProviderServices`                                  |
| Cold play — AllAnime        | 1 miss     | 0         | 0                   | 1                                         | 1–2 GQL + 1–2 episode GQL + N link fetches | 0–M m3u8 variant | Memoize failed referer; parallel cap                           |
| Provider-local retry        | 0          | 0         | 0                   | Next candidate only                       | 0                                          | 0                | Already sequential via `runProviderCycle`                      |
| Global fallback             | 1          | 0         | 1                   | 1 next provider                           | varies                                     | varies           | Health-skip offline providers                                  |
| Prefetch next episode       | 1          | 0         | 0                   | 1 background                              | same as provider                           | same             | Joined via resolve work key                                    |
| Recovery dead stream        | invalidate | 0         | 1 probe             | 1 re-resolve                              | varies                                     | varies           | Reuse inventory when valid                                     |
| Late subtitles (VidKing TV) | 0          | 0         | 0                   | 0                                         | 0                                          | 0                | **Already** `resolveSubtitlesByTmdbId` (Wyzie)                 |
| Anime play                  | —          | —         | —                   | —                                         | —                                          | —                | Wyzie late path uses `title.id` as TMDB — **won’t help anime** |

---

## 5. Redundant-request and latency risks (with owners)

| ID  | Risk                                                                    | Owner file(s)                                   | Proof / test seam                                                                               |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R1  | VidKing 404/empty retried × query variants × servers × embed tier       | `packages/providers/src/vidking/direct.ts`      | Mock 404 → assert single HTTP per server; assert year variant skipped when only `tmdbId` needed |
| R2  | VidKing WASM decode serialized globally                                 | `vidking/direct.ts` `wasmDecodeQueue`           | Concurrent resolve test (latency)                                                               |
| R3  | Rivestream services fetched every cold resolve                          | `rivestream/direct.ts` ~306–319                 | Two resolves → one services fetch                                                               |
| R4  | AllManga catalog GQL fallback doubles latency on miss                   | `allmanga/api-client.ts` `loadShowCatalogInfo`  | Cache negative referer; fixture for single path                                                 |
| R5  | AllManga episode GQL GET then POST                                      | `api-client.ts` `resolveEpisodeSources`         | Fixture: GET success → no POST                                                                  |
| R6  | AllManga unbounded parallel `apiJobs` per source name                   | `resolveEpisodeSources`                         | Count mocks per resolve                                                                         |
| R7  | Miruro up to 4 pipe `sources` calls per play                            | `miruro/direct.ts` `buildMiruroCycleCandidates` | Cycle stops on first success (existing); tune candidate order                                   |
| R8  | Miruro timing fetched but discarded                                     | `miruro/direct.ts`                              | Fixed: fixture expects `metadata.intro` / `metadata.outro`; CLI merges provider-native timing   |
| R9  | Experiment Miruro strategy (`theanimecommunity.com`) vs production pipe | docs + `MIRURO_BACKEND_REPORT.md`               | **Approved live** only                                                                          |

---

## 6. Richness opportunity map

| Opportunity                    | Provider         | Cost                | Action                                                                                        |
| ------------------------------ | ---------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| Provider intro/outro auto-skip | Miruro           | 0                   | Map pipe timing → `StreamCandidate.metadata`; add `ProviderTimingSource` or extend aggregator |
| Seek-bar VTT in mpv            | Miruro           | 0                   | Pass `artwork.seekBarVttUrl` through mpv IPC if supported                                     |
| Episode titles in anime picker | Miruro           | 0                   | Already in `listEpisodes`; ensure shell uses provider list for anime                          |
| Episode title strings          | AllAnime         | 0                   | Upstream only exposes id strings—cannot invent names without MAL/AniList merge                |
| Search posters / banners       | AllAnime         | 0                   | Already in search results                                                                     |
| Wyzie subtitles                | VidKing TV/movie | +1 HTTP             | **Exists**—improve gating/trigger, don’t reimplement in provider package                      |
| Videasy flavor labels          | Cineby           | 0 extra if promoted | Register in engine only after live validation                                                 |
| HLS seek thumbnails            | VidKing          | +manifest parse?    | **Suspected**—verify with fixture or approved live before building                            |

---

## 7. Stale or misleading documentation

| Location                                                     | Issue                                                 | Correction                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/experiments/.../MIRURO_BACKEND_REPORT.md`              | Claims `theanimecommunity.com` is the primary backend | Production uses `miruro.tv/api/secure/pipe` only                  |
| `.docs/provider-dossiers/PROVIDER_FLOW_DIAGRAMS.md`          | Miruro sequence via theanimecommunity                 | Align with pipe API                                               |
| `.plans/provider-package-implementation.md`                  | Same                                                  | Mark experiment-only path                                         |
| `packages/providers/src/research.ts` miruro `sourceStrategy` | Says “backend episode/media APIs”                     | Say “pipe API (kiwi/bee)”                                         |
| `.docs/provider-dossiers/vidking.md`                         | Implies seek thumbnails in direct resolver            | Direct code does not parse HLS IMAGE tracks                       |
| `episode-metadata-audit/REPORT.md`                           | Miruro titles not wired                               | **Stale** — `fetchMiruroEpisodeCatalog` uses `title`              |
| Prior audit Wyzie key                                        | Wrong static key cited                                | Use `subtitle.ts` key; treat experiment keys as non-authoritative |

**Dossier files to update after review (deterministic evidence only):** `miruro.md`, `vidking.md`, `usage-matrix.md`; add `cineby.md` note that engine registration is research-only.

---

## 8. Experiments index (what to reuse)

| Path                                                   | Value                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `apps/experiments/scratchpads/provider-vidking/`       | Network analysis, WASM decrypt reports, Wyzie lazy-load behavior |
| `apps/experiments/scratchpads/provider-rivestream/`    | Secret key / backendfetch reports                                |
| `apps/experiments/scratchpads/provider-miruro/`        | Pipe decrypt, `MIRURO_BACKEND_REPORT.md` (verify before acting)  |
| `apps/experiments/scratchpads/provider-allmanga/`      | GQL sniff, thumbnail probes                                      |
| `apps/experiments/scratchpads/provider-cineby/`        | Flavor/server matrix, multi-audio, Playwright sniffs (research)  |
| `apps/experiments/scratchpads/episode-metadata-audit/` | Cross-provider episode naming (partially stale for Miruro)       |
| `packages/providers/test/fixtures/*`                   | Normalization contracts for tests                                |

Do **not** import experiment code into production.

---

## 9. Prioritized implementation slices (post-review)

### Slice A — Playback startup: lazy subtitles and timing ladder (P0, UX latency)

- Launch mpv with only the selected/primary subtitle, not the full remote subtitle inventory.
- Attach additional subtitle tracks after `player-ready` / `playback-started`, or on subtitle picker open.
- Add diagnostics timing ladder:
  `provider resolve -> stream selected -> mpv spawned -> IPC ready -> playback started -> late subtitles`.
- **Tests:** mpv arg unit test; persistent-session subtitle attachment test; loading-state phase copy unit test.

### Slice B — Miruro provider-key expansion and stream health (P0, anime fallback)

- Generalize Miruro episode provider keys instead of assuming only `kiwi`/`bee`.
- Build candidates from every provider key that exposes the requested episode/audio category.
- Preserve native provider key labels and per-stream referer.
- Prefer active CDN HLS candidates; penalize direct candidates that recently returned HTTP 403 or failed mpv startup.
- **Tests:** fixture with multiple provider keys; candidate-order test; stream filtering test.

### Slice C — AllManga `Ak` DASH proof and implementation (P0/P1, anime primary)

- In experiments, generate an MPD or EDL from `Ak.rawUrls.vids[]` + `Ak.rawUrls.audios[]` and prove 5s mpv playback.
- If proven, implement `Ak` adapter in `allmanga/api-client.ts`.
- Preserve subtitles from `Ak.subtitles[]`.
- Avoid returning video-only streams.
- **Tests:** `Ak` fixture parse; generated locator contains selected video+audio; provider resolves Solo Leveling S1E1.

### Slice D — Miruro provider timing (P1, zero network)

- Map `sourceData.intro` / `outro` → `StreamCandidate.metadata` (and variant/source metadata).
- Add timing source in `apps/cli/src/infra/timing/` that reads resolve result metadata before AniSkip.
- **Tests:** extend `packages/providers/test/providers.test.ts` miruro fixture; aggregator unit test with metadata-only timing.

### Slice E — VidKing failure-path trim (P1, latency)

- Classify HTTP 404 / definitive `not-found` as non-retryable in `tryVidkingServer`.
- When `tmdbId` is set, skip redundant year query variant unless proven necessary (fixture or approved live).
- **Tests:** mock fetch call count.

### Slice F — Rivestream services cache (P1)

- Module-level TTL cache for `VideoProviderServices` (e.g. 24h) with static fallback list.
- **Tests:** two resolves → one services request.

### Slice G — AllManga referer / GQL path memoization (P2)

- Remember which referer works per `apiUrl` or skip youtu-chan retry when primary succeeds.
- **Tests:** `loadShowCatalogInfo` / `resolveEpisodeSources` fetch counts.

### Slice H — Documentation alignment (P2, no runtime)

- Fix dossiers and `MIRURO_BACKEND_REPORT.md` header (“experiment hypothesis” vs “production path”).

### Slice I — Cineby promotion (P3, gated)

- Requires live validation per flavor server + approval to add module to `container.ts` engine list.
- Inherits slices B/C from VidKing engine.

### Explicitly deferred / rejected

- **Wyzie inside `vidking/direct.ts`:** reject — app-layer late lookup already exists.
- **Miruro via theanimecommunity without live proof:** defer — Suspected only.
- **VidKing HLS seek thumbnails:** defer until manifest evidence exists.

---

## 10. Approval-gated live checks (not run)

| #   | Provider   | Fixture purpose                              | Budget      | Unblocks                                       |
| --- | ---------- | -------------------------------------------- | ----------- | ---------------------------------------------- |
| L1  | Miruro     | `theanimecommunity.com` reachability vs pipe | 1 GET       | Whether to invest in alternate backend         |
| L2  | Miruro     | Pipe `sources` from this network             | 1 pipe call | Environment parity with 2026-05-25 smoke       |
| L3  | VidKing    | Year-less vs year query on fixed TMDB id     | 2 GET       | Slice B variant skip                           |
| L4  | VidKing    | Wyzie search for TMDB series ep              | 1 GET       | Late-subtitle reliability (key already in app) |
| L5  | Cineby     | One flavor server end-to-end                 | 2–4 GET     | Slice F promotion                              |
| L6  | Rivestream | Services list churn                          | 1 GET/day   | TTL choice                                     |

**Redaction:** status codes, field names, timing ms, candidate counts only—no stream URLs, cookies, or subtitle CDN URLs in durable docs.

---

## 11. Verification performed this session

```sh
cd packages/providers && bun test test   # 37 pass, 0 fail
```

Production code and fixtures were not modified (research branch artifacts only).

---

## 12. Paste-ready implementation prompt (after user review)

```text
Implement Slice A (Miruro provider timing) and Slice B (VidKing 404/variant trim) from
.plans/provider-capability-latency-audit.md. Do not add Wyzie to packages/providers.
Add deterministic fetch-count tests. Run packages/providers tests + targeted CLI unit tests.
No live provider calls without approval.
```
