# Kunai — CLI and usage reference

This document is the **canonical** description of command-line flags and common run patterns. It is written so a docs site can import or split it into MDX (clear `##` sections, tables, and copy-paste examples).

Setup, Playwright, and troubleshooting live in [quickstart.md](./quickstart.md). Product scope and disclaimers live in [experience-overview.md](./experience-overview.md).

**Source of truth for flags:** `apps/cli/src/main.ts` — `parseArgs()`.

---

## Run targets

| Command | When to use |
| ------- | ----------- |
| `bun run dev` | From a clone of the repo after `bun install` |
| `bun run dev -- <flags...>` | Pass flags to the CLI through Bun (the `--` is required) |
| `kunai <flags...>` | After `bun run link:global` installs the local binary |

Examples below use `bun run dev --` for copy-paste safety in development.

---

## Flows (what starts after launch)

1. **Interactive** — no bootstrap flags: Ink shell opens; you search and pick everything in the UI.
2. **Bootstrap search** — `-S` / `--search` with a query: shell opens with search already filled (and optionally auto-picks a result; see [Search auto-pick](#search-auto-pick)).
3. **Bootstrap TMDB title** — `-i` / `--id` plus `-t` `movie` or `series`: skips the initial title search for that fixed TMDB id. **Not supported together with anime mode** (a warning is logged and the id path is skipped if `-a` is set).
4. **Anime mode** — `-a` / `--anime`: starts in anime discovery mode (same shell; provider/search behavior follows anime configuration).

History, resume, provider choice, season/episode pickers, and diagnostics export are **in-shell** (command palette `/`, settings, etc.), not separate CLI flags today.

---

## Flags (process argv)

All flags are optional. Values that take an argument consume the **next** argv token (e.g. `-S "My Show"`).

### Core

| Long | Short | Argument | Description |
| ---- | ----- | -------- | ----------- |
| `--search` | `-S` | string | Pre-fill the first search query when the shell opens. |
| `--id` | `-i` | string | TMDB numeric id for direct title bootstrap (non-anime). |
| `--type` | `-t` | `movie` \| `series` | Required with `-i` for a supported bootstrap (other values are ignored with a warning). |
| `--anime` | `-a` | — | Start session in anime mode. |
| `--debug` | | — | Enable structured debug logging (stderr / logger). |

### Session UI density (shell chrome)

Parsed flags feed `shellChrome` for this run (see `parseArgs` in `main.ts`):

| Long | Short | Description |
| ---- | ----- | ----------- |
| `--minimal` | `-m` | **Minimal** footer / chrome for this session. If set, wins over `--quick`. |
| `--quick` | `-q` | **Quick** shell chrome for this session. Also used with `-S` for [search auto-pick](#search-auto-pick). |

### Search auto-pick

Only applies when a **bootstrap search query** is present (`-S`).

| Long | Short | Argument | Description |
| ---- | ----- | -------- | ----------- |
| `--jump` | | integer ≥ 1 | After search results load, automatically select the **n**th result (1-based). |
| `--quick` | `-q` | — | With `-S` only: same as `--jump 1` (first result). Without `-S`, `-q` only affects shell chrome (see above). |

If auto-pick fails (empty results, index out of range), you remain in the shell to choose manually.

### mpv runtime (optional)

Forwarded into the player service for this process (see `MpvRuntimeOptions`):

| Flag | Argument | Description |
| ---- | -------- | ----------- |
| `--mpv-debug` | — | Enable mpv debug behavior for this run. |
| `--mpv-clean` | — | Prefer a clean mpv invocation for this run. |
| `--no-user-mpv-config` | — | Do not load the user mpv config for this run. |
| `--mpv-log-file` | path | Write mpv logs to the given file path. |

### mpv bridge script (persistent autoplay)

For **autoplay-chain** playback, Kunai loads the bundled **`kunai-bridge.lua`** and mirrors it to **`getKunaiPaths().mpvBridgePath`** (Kunai config directory + **`mpv/kunai-bridge.lua`**), updated when the bundled copy is newer.

| OS | Typical `mpvBridgePath` |
| -- | ----------------------- |
| Linux | `$XDG_CONFIG_HOME/kunai/mpv/kunai-bridge.lua` (fallback under `~/.config/kunai/`) |
| macOS | `~/Library/Application Support/kunai/mpv/kunai-bridge.lua` |
| Windows | `%APPDATA%/kunai/mpv/kunai-bridge.lua` (same Kunai config layout as other platforms; bridge loads when IPC is alive) |

**mpv JSON IPC (all platforms Kunai launches on):** one-shot `launchMpv` and persistent autoplay sessions open JSON IPC via a **Unix domain socket** (`TMPDIR`/`TMP`) on Linux/macOS/WSL Linux, or a **Windows named pipe** path such as ``//./pipe/kunai-mpv-<session>`` matching mpv `--input-ipc-server` (Bun duplex connect). Installing mpv via Scoop/winget/Chocolatey only affects **PATH**—it does not replace this IPC handshake.

Override the bridge script path with **`mpvKunaiScriptPath`** in Kunai **`config.json`** for a custom build (checked on all platforms before the mirrored default path).

**`mpvKunaiScriptOpts`** is forwarded as mpv `--script-opts` for the `kunai-bridge` script id (see [mpv script-opts](https://mpv.io/manual/master/#scripting)). Supported keys include **`margin_bottom`**, **`margin_right`**, **`chip_width`**, **`chip_height`**, **`prompt_seconds`** (Lua-only fallback when `user-data/kunai-skip-prompt-ms` is unset; Bun still reads `prompt_seconds` for the delayed auto-skip timer).

**IPC contract (Bun ↔ Lua):** Lua writes `user-data/kunai-request` with `next`, `previous`, `skip`, or `auto-skip`. Bun sets `user-data/kunai-skip-to`, `kunai-skip-auto`, `kunai-skip-kind`, `kunai-skip-label`, `kunai-skip-prompt-ms`, and bumps `kunai-skip-rev` so the overlay timer resets. Keys **n** / **p** / **i** and mouse click on the chip are handled inside mpv.

---

## Environment

| Variable | Effect |
| -------- | ------ |
| `KITSUNE_DEBUG=1` | Debug logging enabled (same general intent as `--debug`; see logger wiring in the app). |

---

## In-shell commands (not argv flags)

These are useful for docs parity so users do not search for a `--history` flag.

| Action | How |
| ------ | --- |
| Resume / history | Command palette (`/`) and history flows in the Ink shell |
| Export diagnostics | `/ export-diagnostics` or command palette — writes **redacted** JSON next to the process cwd |
| Provider / subtitles / episode | Shell pickers and hotkeys (see README “Shell controls”) |

---

## Example commands

```bash
# Interactive
bun run dev

# Search pre-filled
bun run dev -- -S "Breaking Bad"

# First search result only (minimal prompts for that step)
bun run dev -- -S "Dune" -q
bun run dev -- -S "Dune" --jump 1

# Third search result
bun run dev -- -S "Dune" --jump 3

# TMDB direct (movie / series)
bun run dev -- -i 438631 -t movie
bun run dev -- -i 1396 -t series

# Anime mode + debug
bun run dev -- -a --debug

# Dense shell + search
bun run dev -- -m -S "Attack on Titan"

# Global install equivalent
kunai -S "Dune" --jump 1
```

---

## MDX / site generation notes

- Use each `##` as a page section or route segment.
- Tables can map 1:1 to MDX `<table>` or component props.
- When flags change, update **`parseArgs` in `main.ts`** and this file in the same change.
