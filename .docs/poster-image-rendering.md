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
- **Overrides**: `KUNAI_IMAGE_PROTOCOL=auto|none|kitty|sixel|symbols|half-block` (invalid values fall back to auto with optional debug log). Overrides are resolved before every heuristic below and always win.
- **Startup probe**: one Kitty-graphics query + DA1 is sent before Ink mounts (`image/probe.ts`). What the terminal _answers_ beats what its name implies — it is the only way to learn that a Windows Terminal is ≥1.22 or that an unrecognised terminal does sixel.
- **Multiplexers**: inside tmux/screen every graphics protocol needs passthrough wrapping that Kunai does not emit, so detection short-circuits to `chafa` symbols (or half-block). `KITTY_WINDOW_ID` is inherited into tmux panes, so the name check alone would otherwise claim `kitty-native` and every poster would be swallowed.
- **Auto path**: Kitty/Ghostty → `kitty-native`; probe-confirmed kitty graphics → `kitty-native`; probe-confirmed sixel + `chafa` → sixel; WezTerm + `chafa` → sixel; otherwise **half-block**.
- **Half-block is the universal floor.** It decodes in-process and needs no external binary, which is what makes posters work on Windows at all — `chafa` is effectively never installed there.
- **Ink app shell**: non-Kitty sixel capabilities are normalized to `chafa` symbols before rendering so poster output stays inside Ink's layout instead of corrupting or shifting the interactive shell. Terminals that answer the kitty probe but implement no Unicode placeholders (WezTerm's opt-in mode, Konsole) also stay on text renderers, since a real placement would fight Ink's layout.

Details live in `apps/cli/src/image/capability.ts`.

## Environment variables

| Variable                        | Purpose                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `KUNAI_POSTER`                  | `0` / `false` disables poster flows                                                                     |
| `KUNAI_IMAGE_PROTOCOL`          | Force or constrain renderer (see capability module)                                                     |
| `KUNAI_IMAGE_SIZE`              | Size string for generic `displayPoster()` (default in `index.ts`)                                       |
| `KUNAI_IMAGE_DEBUG`             | `1` enables `[kunai:image]` debug lines                                                                 |
| `KUNAI_IMAGE_PROBE`             | `0` / `false` skips the startup graphics probe (falls back to name heuristics)                          |
| `KUNAI_IMAGE_TRANSPORT`         | `file` / `direct` / `auto` — how Kitty pixel data reaches the terminal (see below)                      |
| `KUNAI_IMAGE_MAGICK_TIMEOUT_MS` | Per-conversion time budget for the `magick` subprocess (default **30000**, clamped **1000**–**120000**) |

### `KUNAI_IMAGE_TRANSPORT`

Kitty accepts pixels either inline through the PTY (`t=d`, base64 chunks) or as a
temp file it reads and deletes (`t=t`). File transmission skips the PTY entirely
and skips compression, so it is markedly faster — but Kunai sends `q=2`, which
suppresses error replies, so a terminal that does not implement `t=t` fails
**silently** and simply never draws the poster.

Auto-detection therefore only uses files where support is documented: local
kitty and Ghostty, never over SSH (the terminal cannot see our filesystem) and
never inside tmux/screen. Everything else — including terminals that answer the
probe on an unknown name — uses chunks, which work anywhere the protocol works.

Set `direct` to force chunks (the fix if posters silently fail to appear on a
kitty-compatible terminal), or `file` to force the fast path. Invalid values fall
back to auto with a debug line.

## Tools

- **`chafa`** _(optional)_: Sixel/symbols output for non-Kitty terminals; required for forced `sixel` / `symbols`. When absent, the half-block renderer takes over — posters degrade in fidelity but never disappear.
- **`magick` (ImageMagick 7+)** _(optional, last resort)_: PNG passes through untouched and JPEG (all of TMDB) decodes in-process, so `magick` is no longer on the hot path. It is only reached for formats the in-process decoder cannot read (WebP, AVIF). The CLI invokes `magick` only (not other binary names).

## App-shell `PosterResult` kinds

- **`kitty`**: Kitty graphics protocol + placeholder grid for Ink layout.
- **`text`**: chafa symbols _or_ in-process half-block output as placeholder text. The app shell prefers chafa (symbol selection and dithering give higher fidelity) and falls back to half-block, so this kind covers every terminal without kitty graphics.
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
