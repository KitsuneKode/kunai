---
status: current
lastReviewed: "2026-08-17"
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
  -> "tobeparsed" AES-256-GCM payload (rotated hex key, build id 119, 7-day epochs)
  -> decoded source names + encoded API paths (or direct https embeds)
  -> per-source API fetch on allanime.day
  -> mp4 / HLS / DASH-shaped candidates
```

ani-cli currently generates links for these source families:

| Source family       | ani-cli behavior                          | Kunai behavior today                                                                      |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Default`           | WIXMP/repackager or master HLS extraction | Supported                                                                                 |
| `Yt-mp4`            | direct tools/fast4speed URL               | Supported                                                                                 |
| `S-mp4`             | API JSON with direct mp4 when present     | Supported when link exists                                                                |
| `Mp4`               | mp4upload page scrape                     | Supported (embed scrape + `Referer: https://www.mp4upload.com`, scoped `--tls-verify=no`) |
| `Fm-mp4` / Filemoon | AES/decrypt path                          | Removed upstream (b8032b7); no Kunai code path remains                                    |
| `Ak`                | Not in the older ani-cli provider list    | **Current drift gap**                                                                     |

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

Kunai currently skips `Ak`, so the provider returns no streams. This is a source-shape mismatch, not a provider outage and not simple slowness.

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
- The AES-256-GCM `tobeparsed` decode path and build id 119 crypto bootstrap are verified working (re-derived 2026-08-17 after the 81→119 build rotation; episodes resolve through a user relay); AES-CTR must not be restored (see `.docs/providers.md`).
- Source APIs can return valid data that is not a single HLS/mp4 URL.
- Returning only the `Ak` video URL would be wrong because audio is separate.
- The provider contract already allows `protocol: "dash"` and `container: "mpd"`, but there is no implemented AllManga MPD/EDL handoff for `rawUrls`.

## Recovering a build rotation

Upstream rotates the client crypto roughly monthly (`81` → `119` → `140` → `166`).
Every pinned constant moves at once, and a partial update fails exactly like a
total one, so recover them together. Done 2026-09-08 for `140` → `166`.

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
`client-crypto` (`BVxTyUEI.js` on 2026-09-08); reach it by crawling
`_app/immutable/entry/app.*.js`. Strings are 3-character fragments in a rotated
table, so nothing greps out as a literal. Evaluate `function Xc()` (the table),
`function Vr` (the accessor) and the rotation IIFE that ends `})(Xc, …)`
together, then read:

- `cd = fr(296)` — the build id.
- `mm` — the four base64 8-byte mask fragments.
- `Rf` — **an ordinary object literal with the derivation constants in plain
  sight**: `saltMul`, `saltAdd`, `fragMul`, `fragAdd`, `bootPrefix`, `join`, and
  `parts`. `parts` is the boot payload field order and rotates independently of
  the separator; build 140 signed `group.host.lane.buildId.epoch`, build 166
  signs `group:lane:epoch:host:buildId`.

**The persisted query hash rotates too**, and separately. It is a true persisted
query — the document is never sent — so a stale hash returns
`PersistedQueryNotFound` and every resolve yields zero streams. Rebuild it by
expanding the episode query template (`iK`, with its `Mi` / `Kt` / `en()`
fragments) and taking `sha256` of the result.

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

### P0: Promote the proven `Ak` DASH shape behind tests

The Solo Leveling proof confirms generated MPD playback with audio. Production work can now proceed behind fixtures and tests:

- Add an AllManga source adapter for `Ak`.
- Emit a `dash` stream with a generated local MPD/deferred locator, or extend the provider result contract if local MPD ownership belongs outside provider parsing.
- Preserve subtitles from the `Ak` payload.
- Add fixture tests for the `Ak` payload and selected stream mapping.

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
