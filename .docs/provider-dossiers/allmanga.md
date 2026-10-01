---
status: current
lastReviewed: "2026-10-02"
---

# Provider: AllManga / AllAnime

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Summary

- **Runtime class:** Direct HTTP GraphQL + decoded source APIs. No browser should be needed on the hot path.
- **Reference implementation:** Local ani-cli checkout at `~/Projects/osc/ani-cli` — historical only: ani-cli v5 (2026-08-01) moved to anidb.app and deleted its AllAnime code, so the live mkissa JS chunk is the sole source of truth now.
- **Production module:** `packages/providers/src/allmanga/*`.
- **Current status (2026-07-18):** Episode resolve requires ani-cli `aaReq` AES-GCM attestation + rotated hex decrypt key (`origin/fix`). Without it the API returns `AA_CRYPTO_MISSING`. Search/episode catalog POST paths still work without `aaReq`.

## Current Evidence

### Search and catalog

- `searchAllManga()` uses the `shows` GraphQL query against `https://api.allanime.day/api`.
- `loadShowCatalogInfo()` uses a show GraphQL query and caches `availableEpisodesDetail`, `episodeCount`, AniList/MAL IDs, and thumbnail data for 45 seconds.
- Browser harvest on 2026-05-25 confirmed AllAnime GraphQL works with the `https://youtu-chan.com` referer.
- The benchmark for `solo leveling` must pin Season 1. Broad search currently returns Season 2 at index `0`; Season 1 is index `1` with AniList `151807` and AllManga id `B6AMhLy6EQHDgYgBF`.

### Stream source flow

The source flow matches ani-cli:

```text
episode GraphQL persisted GET + aaReq + x-build-id
  -> "tobeparsed" AES-256-GCM payload (rotated hex key, build id 166, 7-day epochs)
  -> decoded source names + encoded API paths (or direct https embeds)
  -> per-source API fetch on allanime.day
  -> mp4 / HLS / DASH-shaped candidates
```

ani-cli currently generates links for these source families:

| Source family       | ani-cli behavior                          | Kunai behavior today                                                                                                                                                                            |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Default`           | WIXMP/repackager or master HLS extraction | Supported                                                                                                                                                                                       |
| `Yt-mp4`            | direct tools/fast4speed URL               | Supported                                                                                                                                                                                       |
| `S-mp4`             | API JSON with direct mp4 when present     | Supported when link exists                                                                                                                                                                      |
| `Mp4`               | mp4upload page scrape                     | Supported (embed scrape + `Referer: https://www.mp4upload.com`, scoped `--tls-verify=no`)                                                                                                       |
| `Fm-mp4` / Filemoon | AES/decrypt path                          | Removed upstream (b8032b7); no Kunai code path remains                                                                                                                                          |
| `Ak`                | Not in the older ani-cli provider list    | **Supported** — `fetchAkLinks` picks one video + one audio `rawUrls` representation, registers a deferred locator, and `deferred-media-materializer` writes a SegmentBase MPD mpv plays locally |

### Solo Leveling S01E01 drift

Live probe on 2026-05-25:

- Correct title: `B6AMhLy6EQHDgYgBF`, episode string `1`, mode `sub`.
- Decoded sources: `Ak`, `S-mp4`.
- `S-mp4` returned a JSON object with `mp4: true` and no usable `link`.
- `Ak` returned `links[0].dash === true`, subtitles, and `rawUrls` with:
  - `vids[]`: multiple video-only `video/mp4` segment-base URLs.
  - `audios[]`: multiple audio-only `audio/mp4` segment-base URLs.
  - `duration`: media duration.
  - `subtitles[]`: English ASS subtitle endpoint.

At the time Kunai skipped `Ak`, so the provider returned no streams — a source-shape mismatch, not a provider outage. `Ak` is now implemented: `rawUrls` become a generated local MPD (see below).

### `Ak` DASH proof, 2026-05-26

Command:

```sh
cd .reference/experiments
bun scratchpads/provider-allmanga/allmanga-ak-dash-proof.ts
```

Report:

```text
.reference/experiments/scratchpads/provider-allmanga/allmanga-ak-dash-proof-report.json
```

Result:

| Field                  | Value                                 |
| ---------------------- | ------------------------------------- |
| `providerOk`           | `true`                                |
| `akFound`              | `true`                                |
| `videoRepresentations` | `16`                                  |
| `audioRepresentations` | `3`                                   |
| `subtitleCount`        | `1`                                   |
| `mpvStarted`           | `true`                                |
| `mpvMs`                | ~1.3-1.6 s across repeated local runs |
| `failure`              | `null`                                |

The experiment generated a temporary MPD from one selected video representation and one selected audio representation, then let mpv play through the intended 5-second proof window. The durable report is redacted and contains no raw media URLs or signed query params. The current script cleans the temp directory for its own run; older temp MPDs from earlier unsafe proof runs may still exist under `/tmp/kunai-allmanga-ak-*` and should be removed manually or with explicit approval.

## Known

- GraphQL search/catalog is working with `youtu-chan.com` referer.
- The AES-256-GCM `tobeparsed` decode path and the build id 166 crypto bootstrap are verified working (re-derived 2026-09-08 after the 140→166 rotation; the episode query executes and `aaReq` is accepted); AES-CTR must not be restored (see `.docs/providers.md`).
- Source APIs can return valid data that is not a single HLS/mp4 URL.
- Returning only the `Ak` video URL would be wrong because audio is separate — the generated MPD carries one video + one audio representation.
- `Ak` handoff **is implemented**: `fetchAkLinks` normalizes `rawUrls` (`vids`/`audios`/`subtitles`/`duration`), registers a `allmanga-ak:` deferred locator, and `apps/cli/src/services/playback/deferred-media-materializer.ts` writes the SegmentBase MPD into a private temp dir at playback time. The playback materializer releases each `allmanga-ak:` locator during cleanup. Deferred entries are not persisted in the playback cache, and source-cache entries containing them are evicted before reuse rather than replayed.

## Recovering a build rotation

Upstream rotates the client crypto roughly monthly
(`81` → `119` → `140` → `166` → `171` → `177`). The _derivation_ constants
move together — build id, salts, fragment offsets, mask fragments, key, epoch —
and a partial update fails exactly like a total one, so recover those as a set.
The persisted-query hash rotates on its own schedule and can be stale while the
derivation set is current, or the reverse; either way every resolve returns
zero streams, so check both. Done 2026-09-08 for `140` → `166`, and again
2026-10-13 for `171` → `177` (two intermediate builds `172`–`176` never made it
into the tree — probing `166`–`174` returned `unknown_build_id` while `177`
answered `invalid_boot_token`, bracketing the live generation before the chunk
was read).

**Read the failure first — the endpoint says which half is stale.**

| Bootstrap answer                  | Meaning                                               |
| --------------------------------- | ----------------------------------------------------- |
| `404 unknown_build_id`            | `ALLMANGA_BUILD_ID` rotated out                       |
| `403 invalid_boot_token`          | build id is current, the derivation constants rotated |
| `400 missing_build_id` / `..lane` | a dropped query param, not upstream drift             |
| Cloudflare HTML instead of JSON   | missing `Referer`/`Origin: https://mkissa.to`         |

Scanning build ids until the answer flips from `unknown_build_id` to
`invalid_boot_token` brackets the live build without reading any JS.

**Then re-extract from the crypto chunk.** It is the chunk under
`cdn.mkissa.net/all/mk/_app/immutable/chunks/` containing both `buildId` and
`client-crypto` (`BVxTyUEI.js` on 2026-09-08, `RD7DzHLl.js` on 2026-10-13);
reach it by crawling `_app/immutable/entry/app.*.js`. Strings are 3-character
fragments in a rotated table, so nothing greps out as a literal — and **every
symbol name in this section rotates with the build**, so find them by shape,
not by name. On build 177 the pieces were: `tu()` returns the string array;
`Un(e) = tu()[e - 374]` is the accessor; `At`/`cr` are two-arg wrappers over
`Un`; and a `push/shift` checksum IIFE `})(tu, N)` rotates the array in place —
replay it verbatim in a JS engine before reading. The config object literal
(`$f`, next to the `tu` table) then reads almost plainly:

- `saltMul`, `saltAdd`, `fragMul`, `fragAdd` — literal numbers.
- `bootPrefix`, `parts` — concatenated `At()`/`cr()` calls plus suffixes;
  `join` is a literal.
- `md = cr(…)` — the build id (`"177"` on 2026-10-13).
- `vm = [At(…)+…, …]` — the four base64 8-byte mask fragments.
- New on 177: `v`, `omitEmptyLane`, `envXor`. `envXor` is XORed into every
  mask-key byte only when the `Xk()` browser-env probe passes; API requests
  accept the raw mask, so it is documented in `crypto.ts` but not ported.

Historic name map for orientation: 140/166 called the table `Xc`, the accessor
`Vr`, the config `Rf`, the masks `mm`, and the build id `cd = fr(296)`. `parts`
is the boot payload field order and rotates independently of the separator;
build 140 signed `group.host.lane.buildId.epoch`, build 166 signed
`group:lane:epoch:host:buildId`, build 177 signs `group/lane/host/buildId/epoch`.

**The persisted query hash rotates too**, and separately. It is a true persisted
query — the document is never sent — so a stale hash returns
`PersistedQueryNotFound` and every resolve yields zero streams. Rebuild it by
expanding the episode query template — find the builder whose body contains
`episode(` (named `iK` on 140, `Dj` on 177) and expand its fragments (`Oi`,
`Kt`, `Zr()`, and their children `Hd`, `Hs`, `ku`→`Ka`→`fR`/`dp`→`mR`/`up`),
then take `sha256` of the result with the mobile-only `$qat` lines omitted —
the pinned hash is the desktop variant.

Confirm the whole chain live before landing: bootstrap must answer `200` with a
`partB`, the episode GET must return `"tobeparsed"` rather than an
`AA_CRYPTO_*` or `PersistedQueryNotFound` error, and the resolved URL must
decode — `mpv --no-config --vo=null --ao=null --frames=2`. On 2026-09-08 that
chain produced h264 1920x1080 with `alang=jpn` audio from `video.wixstatic.com`.

`NEED_CAPTCHA` after a few rapid resolves is upstream rate limiting, not a
crypto fault; it surfaces as `AllMangaCaptchaError` and must not be worked
around.

## Unknown

- Whether mpv can play generated `Ak` MPDs reliably across titles beyond the Solo Leveling proof.
- Whether AllManga emits `Ak` broadly or only for specific catalog/CDN cases.
- Whether the local ani-cli branch has since gained `Ak` support upstream. Re-check before production implementation.

## Recommended Fix Shape

### P0: `Ak` DASH — landed

The Solo Leveling proof confirms generated MPD playback with audio, and the
production path now implements it: `fetchAkLinks` → deferred locator →
generated local MPD at playback materialization. Subtitles from the `Ak`
payload ride `normalizeAkSubtitles`; fixture tests pin the payload shape and
stream mapping.

### P1: Expand the proof matrix

Before broad confidence:

1. Run the same MPD proof against at least two more AllManga titles.
2. Include one dub case if `Ak` emits dub audio.
3. Confirm token expiry and cache TTL expectations for generated MPDs.

### P2: Keep request economy bounded

- Keep persisted GET first and POST fallback second.
- Keep show catalog/source caches.
- Bound parallel per-source API jobs if source count grows.
- Memoize source-family failures per episode during one resolve so empty `S-mp4` does not get retried uselessly.

## Regression Samples

| Case                       | Identity                                                    | Expected                                                            |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Solo Leveling S1E1 sub     | AllManga `B6AMhLy6EQHDgYgBF`, AniList `151807`, episode `1` | `Ak` DASH shape, should eventually play with audio                  |
| Solo Leveling broad search | Query `solo leveling`                                       | Season 2 index `0`, Season 1 index `1`; benchmark must pin identity |
| Existing fixture           | `packages/providers/test/fixtures/allmanga/*`               | Existing Default/S-mp4 behavior remains stable                      |

## Rejected Shortcuts

- Do not return video-only `Ak` URLs.
- Do not add Playwright to AllManga production resolve.
- Do not treat broad search index `0` as the expected title for latency comparisons.
