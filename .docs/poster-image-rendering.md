# Poster and terminal image output

Use this doc when changing terminal poster previews, capability detection, the shared image subsystem, or Ink app-shell poster behavior.

## Code map

| Area                                        | Role                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cli/src/image/`                       | Shared subsystem: `detectImageCapability()`, `displayPoster()`, TMDB poster cache, Kitty/chafa/noop renderers, PNG helpers, optional ImageMagick (`magick`) conversion via `convert.ts` (subprocess timeout) |
| `apps/cli/src/app-shell/poster-renderer.ts` | App-shell rendering: Kitty inline graphics + chafa **symbols** stdin path for non-Kitty capability; returns `PosterResult` (`kitty`, `text`, or `none`)                                                      |
| `apps/cli/src/app-shell/image-pane.ts`      | Fetches TMDB bytes, calls `renderPoster`, LRU cache keyed by URL + dimensions + **renderer id**                                                                                                              |
| `apps/cli/src/ui.ts`                        | `checkDeps()` snapshot: `chafa`, `magick`, `image` capability; degraded notices for missing tools                                                                                                            |

Use `@/image` or `apps/cli/src/image/index.ts` (the old `apps/cli/src/image.ts` file was removed).

## Capability selection (summary)

- **TTY / disable**: non-TTY stdout or `KUNAI_POSTER=0|false` → no posters.
- **Overrides**: `KUNAI_IMAGE_PROTOCOL=auto|none|kitty|sixel|symbols` (invalid values fall back to auto with optional debug log).
- **Auto path**: Kitty/Ghostty → `kitty-native`; Windows Terminal + `chafa` → sixel; WezTerm + `chafa` → sixel; otherwise `chafa` symbols if available.

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

## Debugging

1. Set `KUNAI_IMAGE_DEBUG=1` and watch stderr for `[kunai:image]`.
2. Use `/diagnostics` (or About) to see `chafa`, `magick`, and active image renderer / terminal in the capability line.

## Tests

- `apps/cli/test/unit/image.test.ts` — subsystem (capability, cache, Kitty, chafa commands, `displayPoster`).
- `apps/cli/test/unit/app-shell/poster-renderer.test.ts` — renderer result kinds under mocked capability.
- `apps/cli/test/unit/app-shell/image-pane.test.ts` — cache key segregation by renderer + existing poster URL helpers.

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/image.test.ts
bun test apps/cli/test/unit/app-shell/poster-renderer.test.ts
bun test apps/cli/test/unit/app-shell/image-pane.test.ts
```
