# Poster and terminal image output

Use this doc when changing terminal poster previews, capability detection, the shared image subsystem, or Ink app-shell poster behavior.

## Code map

| Area                                                 | Role                                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cli/src/image/`                                | Shared subsystem: `detectImageCapability()`, `displayPoster()`, TMDB poster cache, Kitty/chafa/noop renderers, PNG helpers, optional ImageMagick (`magick`) conversion via `convert.ts` (subprocess timeout) |
| `apps/cli/src/app-shell/poster-renderer.ts`          | App-shell rendering: Kitty inline graphics + chafa **symbols** stdin path for non-Kitty capability; returns `PosterResult` (`kitty`, `text`, or `none`)                                                      |
| `apps/cli/src/app-shell/kitty-placement-registry.ts` | Named Kitty slots (`postplay-hero`, discovery 0–2, browse-preview, …); per-slot delete so siblings coexist                                                                                                   |
| `apps/cli/src/app-shell/image-pane.ts`               | Fetches TMDB/remote bytes or local thumbnail bytes, calls `renderPoster`, LRU cache keyed by URL/path + dimensions + **renderer id** (+ slot for Kitty)                                                      |
| `apps/cli/src/app-shell/poster-source-cache.ts`      | Resolves TMDB poster paths, absolute remote URLs, and local `file://` / absolute thumbnail paths without confusing local files for TMDB paths                                                                |
| `apps/cli/src/ui.ts`                                 | `checkDeps()` snapshot: `chafa`, `magick`, `image` capability; degraded notices for missing tools                                                                                                            |

Use `@/image` or `apps/cli/src/image/index.ts` (the old `apps/cli/src/image.ts` file was removed).

## Capability selection (summary)

- **TTY / disable**: non-TTY stdout or `KUNAI_POSTER=0|false` → no posters.
- **Overrides**: `KUNAI_IMAGE_PROTOCOL=auto|none|kitty|sixel|symbols` (invalid values fall back to auto with optional debug log).
- **Auto path**: Kitty/Ghostty → `kitty-native`; Windows Terminal + `chafa` → sixel for one-shot output; WezTerm + `chafa` → sixel; otherwise `chafa` symbols if available.
- **Ink app shell**: non-Kitty sixel capabilities are normalized to `chafa` symbols before rendering so poster output stays inside Ink's layout instead of corrupting or shifting the interactive shell.

Details live in `apps/cli/src/image/capability.ts`.

## Environment variables

| Variable                        | Purpose                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `KUNAI_POSTER`                  | `0` / `false` disables poster flows                                                                     |
| `KUNAI_IMAGE_PROTOCOL`          | Force or constrain renderer (see capability module)                                                     |
| `KUNAI_IMAGE_SIZE`              | Size string for generic `displayPoster()` (default in `index.ts`)                                       |
| `KUNAI_IMAGE_DEBUG`             | `1` enables `[kunai:image]` debug lines                                                                 |
| `KUNAI_IMAGE_MAGICK_TIMEOUT_MS` | Per-conversion time budget for the `magick` subprocess (default **30000**, clamped **1000**–**120000**) |

## Tools

- **`chafa`**: Sixel/symbols output for non-Kitty terminals; required for forced `sixel` / `symbols` and for Windows Terminal / WezTerm auto paths where applicable.
- **`magick` (ImageMagick 7+)**: Converts non-PNG raster sources to PNG for Kitty-native and shared renderer paths when TMDB serves JPEG/WebP. The CLI invokes `magick` only (not other binary names).

## App-shell `PosterResult` kinds

- **`kitty`**: Kitty graphics protocol + placeholder grid for Ink layout.
- **`text`**: chafa symbols output as placeholder text (fallback terminals).
- **`none`**: Silent skip; UI shows “Poster unavailable” when appropriate.

In Ink, browse and playback companion panes both render `placeholder` for **`kitty`** and **`text`**; only **`none`** (or missing URL while loading) shows the unavailable copy.

## Offline thumbnails

Downloads persist the title poster URL and cached IntroDB/AniSkip timing in `download_jobs`.
When offline artwork caching is enabled and a poster URL exists, the download service caches
the poster as a local sidecar preview next to the completed video using the pattern:

```text
Title - S01E01.mp4
Title - S01E01.thumbnail.jpg
```

The offline library chooses previews in this order:

1. Cached local poster artwork path.
2. Persisted poster URL.
3. Text-only shelf details.

Artwork caching is post-completion and best effort: Kunai fetches the persisted poster URL,
writes the sidecar atomically, then records `thumbnail_path`. Missing poster metadata, disabled
offline artwork caching, failed artwork fetch/decode, missing terminal graphics support, or a tiny
terminal must degrade to text without blocking playback or marking the download failed. Kunai does
not require or spawn `ffmpeg` for normal playback or offline artwork.

## Multi-image Kitty (Ink)

- Each `usePosterPreview` / `fetchPoster` call that owns Kitty graphics should pass a `placementSlot`.
- Slot cleanup deletes **only that image id** (`d=I`). Global wipe (`d=A`) is reserved for surface exit, terminal resize (unslotted), and capability loss.
- Post-play wide budget: hero **or** rail primary Kitty, plus up to **3** discovery cards as Kitty. Mini-cards stay chafa.
- JPEG/WebP without `magick`: Kitty path falls back to chafa symbols for that slot instead of silent `none`.

## Manual Ghostty / Kitty smoke (not CI)

Headless CI cannot assert framebuffer graphics. After image changes, smoke locally in Ghostty or Kitty:

1. `KUNAI_IMAGE_DEBUG=1 bun run dev` — confirm capability line shows `kitty-native`.
2. Play any title with a poster, finish playback → post-play wide (≥120 cols).
3. Expect: next-up hero art **and** up to 3 discovery thumbs visible together (no blank slots racing).
4. Change selection / leave post-play — no ghost images left on the browse screen.
5. Optional: uninstall `magick` temporarily and confirm JPEG thumbs still show as chafa text rather than empty.

## Debugging

1. Set `KUNAI_IMAGE_DEBUG=1` and watch stderr for `[kunai:image]`.
2. Use `/diagnostics` (or About) to see `chafa`, `magick`, and active image renderer / terminal in the capability line.

## Tests

- `apps/cli/test/unit/image.test.ts` — subsystem (capability, cache, Kitty, chafa commands, `displayPoster`).
- `apps/cli/test/unit/app-shell/poster-renderer.test.ts` — renderer result kinds under mocked capability + JPEG fallback.
- `apps/cli/test/unit/app-shell/image-pane.test.ts` — cache key segregation by renderer + existing poster URL helpers.
- `apps/cli/test/unit/app-shell/kitty-placement-registry.test.ts` — multi-slot delete isolation.
- `apps/cli/test/unit/app-shell/use-poster-preview.resize.test.tsx` — unslotted geometry change still emits `d=A`.

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/image.test.ts
bun test apps/cli/test/unit/app-shell/poster-renderer.test.ts
bun test apps/cli/test/unit/app-shell/image-pane.test.ts
bun test apps/cli/test/unit/app-shell/kitty-placement-registry.test.ts
```
