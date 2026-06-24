# Share Links & PlaybackTargetRef

Kunai uses one portable `kunai://` link format for sharing what to play across machines, providers, and surfaces.

## URL grammar

```
kunai://play?cat=<ns>:<id>&kind=<movie|series|anime>&s=<season>&e=<episode>&abs=<absolute>&t=<seconds>&src=<providerId>&sq=<quality>&n=<label>
kunai://download?...   # same query params, queues a download instead of playback
```

Search fallback when no catalog id is known:

```
kunai://play?q=<query>&kind=...
```

### Parameters

| Param     | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `cat`     | Catalog anchor: `tmdb`, `anilist`, `mal`, or `imdb` namespace + id (`tmdb:1396`) |
| `q`       | Search query fallback (mutually exclusive with `cat`)                            |
| `kind`    | `movie`, `series`, or `anime`                                                    |
| `s` / `e` | Season and episode (1-based)                                                     |
| `abs`     | Absolute episode number (anime)                                                  |
| `t`       | Start timestamp in seconds, `1m23s`, or `1:23`                                   |
| `src`     | Provider hint (`allanime`, etc.)                                                 |
| `sq`      | Quality hint                                                                     |
| `n`       | Human label (not required for resolution)                                        |

Parser returns `null` when neither `cat` nor `q` is present, or when the catalog namespace is invalid.

## Code map

| Path                                               | Role                                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| `apps/cli/src/domain/share/playback-target-ref.ts` | Model, timestamp helpers, encode/parse codec              |
| `apps/cli/src/app/share-ref-from-context.ts`       | Build refs from title/session context                     |
| `apps/cli/src/app/resolve-share-target.ts`         | Container-aware resolver (catalog, search, anime mapping) |
| `apps/cli/src/app/apply-resolved-share-target.ts`  | Apply resolved targets to bootstrap launch                |
| `apps/cli/src/app/share-bootstrap-start.ts`        | One-shot shared timestamp mailbox for first play          |
| `apps/cli/src/app/copy-share-link.ts`              | Clipboard helper                                          |

## Surfaces

- `/share` — copy a catalog-anchored link (optional timestamp picker when resume position exists)
- `/watch` — parse clipboard URL, resolve, launch with `startSeconds`
- `kunai --open <url>` — trusted launch (no protocol confirmation)
- `kunai --handoff-url <url>` — OS protocol handler path (confirmation required)
- Post-play **Share link** action and history **Copy share link**
- mpv `Ctrl+Shift+S` — copy link at live `time-pos`
- Discord Rich Presence — https catalog button; playable `kunai://` ref in presence text (not a button; Discord only allows http(s) buttons)

## Timestamp resume

Shared `t=` is applied once on the first mpv launch via `resolveBootstrapStartSeconds` (max of shared vs local history). Normal per-episode history resume takes over afterward.

## Examples

```text
kunai://play?cat=tmdb%3A1396&kind=series&s=1&e=3
kunai://play?cat=anilist%3A21&kind=anime&s=1&e=1&t=120
kunai://play?q=One%20Piece&kind=anime
kunai --open "kunai://play?cat=tmdb%3A438631&kind=movie"
```
