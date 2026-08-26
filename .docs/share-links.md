---
status: current
lastReviewed: "2026-08-24"
---

# Share Links & PlaybackTargetRef

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Kunai copies browser-safe `https://kunai.kitsunekode.in/w/<code>` links while preserving the portable `kunai://` application handoff. Both decode to the same catalog-anchored playback target.

The web code is a checksummed, base64url-encoded ref. The landing page is a pure decoder: it uses no share database and drops `/w/` page views before analytics sends. Compact `k1…` catalog codes are accepted directly and inside `/w/<code>`; search anchors deliberately have no compact form.

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

| Path                                                        | Role                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `packages/types/src/share.ts`                               | Shared CLI/docs codec, HTTPS envelope, and compact codes  |
| `apps/cli/src/domain/share/playback-target-ref.ts`          | CLI-local re-export seam                                  |
| `apps/cli/src/app/bootstrap/share-ref-from-context.ts`      | Build refs from title/session context                     |
| `apps/cli/src/app/bootstrap/resolve-share-target.ts`        | Container-aware resolver (catalog, search, anime mapping) |
| `apps/cli/src/app/bootstrap/apply-resolved-share-target.ts` | Apply resolved targets to bootstrap launch                |
| `apps/cli/src/app/bootstrap/share-bootstrap-start.ts`       | One-shot shared timestamp mailbox for first play          |
| `apps/cli/src/app/bootstrap/copy-share-link.ts`             | Clipboard helper                                          |
| `apps/cli/src/domain/share/qr-code.ts`                      | Dependency-free QR Model 2 encoder                        |
| `apps/cli/src/app-shell/share-qr-shell.tsx`                 | Half-block terminal QR surface                            |
| `apps/docs/app/w/[code]/page.tsx`                           | Stateless browser fallback and app handoff                |

## Surfaces

- `/share` — copy the browser-safe HTTPS form (optional timestamp picker when resume position exists)
- `/share --qr` — show a compact HTTPS QR and copy the full HTTPS form
- `/watch` — parse HTTPS, `kunai://`, or compact clipboard input, resolve, launch with `startSeconds`
- `kunai --open <url>` — trusted launch (no protocol confirmation)
- `kunai --handoff-url <url>` — OS protocol handler path (confirmation required)
- Post-play **Share link** action and history **Copy share link**
- mpv `Ctrl+Shift+S` — copy the HTTPS link at live `time-pos`
- Discord Rich Presence — **Play on Kunai** button carrying the https web-share URL, plus an https catalog button; the `kunai://` ref also stays in presence text (Discord only allows http(s) button URLs, so the play button uses the web route)

## Timestamp resume

Shared `t=` is applied once on the first mpv launch via `resolveBootstrapStartSeconds` (max of shared vs local history). Normal per-episode history resume takes over afterward.

## Examples

```text
kunai://play?cat=tmdb%3A1396&kind=series&s=1&e=3
kunai://play?cat=anilist%3A21&kind=anime&s=1&e=1&t=120
kunai://play?q=One%20Piece&kind=anime
https://kunai.kitsunekode.in/w/v1.<encoded-ref>
k1pts.1396.1.3.<checksum>
kunai --open "kunai://play?cat=tmdb%3A438631&kind=movie"
```
