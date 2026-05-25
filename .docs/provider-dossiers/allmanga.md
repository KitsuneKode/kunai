# Provider: AllManga / AllAnime

## Summary

- **Runtime class:** Direct HTTP GraphQL + decoded source APIs. No browser should be needed on the hot path.
- **Reference implementation:** Local ani-cli checkout at `~/Projects/osc/ani-cli`.
- **Production module:** `packages/providers/src/allmanga/*`.
- **Current status:** Search and episode catalog are healthy. Some modern source payloads now return DASH-style separate audio/video tracks that Kunai does not yet model, so affected titles resolve no playable stream even though the provider data is valid.

## Current Evidence

### Search and catalog

- `searchAllManga()` uses the `shows` GraphQL query against `https://api.allanime.day/api`.
- `loadShowCatalogInfo()` uses a show GraphQL query and caches `availableEpisodesDetail`, `episodeCount`, AniList/MAL IDs, and thumbnail data for 45 seconds.
- Browser harvest on 2026-05-25 confirmed AllAnime GraphQL works with the `https://youtu-chan.com` referer.
- The benchmark for `solo leveling` must pin Season 1. Broad search currently returns Season 2 at index `0`; Season 1 is index `1` with AniList `151807` and AllManga id `B6AMhLy6EQHDgYgBF`.

### Stream source flow

The source flow matches ani-cli:

```text
episode GraphQL persisted GET
  -> optional POST fallback
  -> "tobeparsed" AES-CTR payload
  -> decoded source names + encoded API paths
  -> per-source API fetch on allanime.day
  -> mp4 / HLS / DASH-shaped candidates
```

ani-cli currently generates links for these source families:

| Source family       | ani-cli behavior                          | Kunai behavior today            |
| ------------------- | ----------------------------------------- | ------------------------------- |
| `Default`           | WIXMP/repackager or master HLS extraction | Supported                       |
| `Yt-mp4`            | direct tools/fast4speed URL               | Supported                       |
| `S-mp4`             | API JSON with direct mp4 when present     | Supported when link exists      |
| `Mp4`               | mp4upload page scrape                     | Not a current production target |
| `Fm-mp4` / Filemoon | AES/decrypt path                          | Partially supported             |
| `Ak`                | Not in the older ani-cli provider list    | **Current drift gap**           |

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
cd apps/experiments
bun scratchpads/provider-allmanga/allmanga-ak-dash-proof.ts
```

Report:

```text
apps/experiments/scratchpads/provider-allmanga/allmanga-ak-dash-proof-report.json
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
- The AES-CTR `tobeparsed` decode constants still match ani-cli parity.
- Source APIs can return valid data that is not a single HLS/mp4 URL.
- Returning only the `Ak` video URL would be wrong because audio is separate.
- The provider contract already allows `protocol: "dash"` and `container: "mpd"`, but there is no implemented AllManga MPD/EDL handoff for `rawUrls`.

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
