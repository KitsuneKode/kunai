# Kunai — Quickstart

Use this doc for setup, local execution, and common environment issues. Architecture and file ownership live elsewhere.

## Prerequisites

- Bun `>=1.3.9` for source installs during beta
- `mpv` in `PATH`
- Kitty/Ghostty for native Kitty poster previews
- `chafa` for poster previews in Windows Terminal/WezTerm/other terminals
- ImageMagick (`magick`) if you want Kitty/Ghostty non-PNG poster conversion
- `ffmpeg` if you want downloads/offline queue

Deeper reference for terminal graphics, env overrides, and testing: [.docs/poster-image-rendering.md](poster-image-rendering.md).

Install runtime tools:

```sh
# Linux (Arch)
sudo pacman -S mpv ffmpeg chafa imagemagick

# Linux (Debian/Ubuntu)
sudo apt install mpv ffmpeg chafa imagemagick

# macOS (Homebrew)
brew install mpv ffmpeg chafa imagemagick
```

Windows options:

- `winget` (recommended): install `mpv`, `ffmpeg`, `chafa` (`winget install hpjansson.Chafa`), and ImageMagick (`winget install ImageMagick.ImageMagick`)
- Chocolatey: `choco install mpv ffmpeg chafa imagemagick`
- Scoop: `scoop install mpv ffmpeg chafa imagemagick`

Kunai is Bun-first in beta. A Node/npm-only source checkout is not supported because the CLI uses Bun runtime APIs directly. Packaged binaries are the preferred future path for users who should not need to install Bun manually.

## Setup

```sh
git clone <repo>
cd kunai
bun install
bun run link:global   # optional: installs local CLI command
```

## Run

```sh
bun run dev
bun run dev -- -S "Attack on Titan"
bun run dev -- -i 1429 -t series
bun run dev -- -i 438631 -t movie
bun run dev -- -a
bun run dev -- -m
bun run dev -- -S "Dune" --jump 1
bun run dev -- -S "Dune" -q
bun run dev -- --debug
kunai -S "Dune"   # after bun run link:global
```

## Dev Checks

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
```

Do not use `bun test` directly.

## VHS Demo Tour

Use these when you want an intuitive visual walkthrough of the shell flows:

```sh
bun run --cwd apps/cli test:vhs:browse
bun run --cwd apps/cli test:vhs:help
bun run --cwd apps/cli test:vhs:launch
```

## CLI flags

Full tables, mpv passthrough flags, and “in-shell only” behavior are documented in **[cli-reference.md](./cli-reference.md)** (canonical for MDX sites).

Summary:

| Flag                    | Short       | Notes                                                             |
| ----------------------- | ----------- | ----------------------------------------------------------------- |
| `--search`              | `-S`        | Pre-fill query                                                    |
| `--id` / `--type`       | `-i` / `-t` | TMDB bootstrap: `-t` is `movie` or `series`                       |
| `--anime`               | `-a`        | Anime mode                                                        |
| `--minimal` / `--quick` | `-m` / `-q` | Session shell chrome; `-q` with `-S` also auto-picks first result |
| `--jump`                |             | With `-S`, auto-pick *n*th result (1-based)                       |
| `--debug`               |             | Verbose logging                                                   |

Use `/ export-diagnostics` in the shell (or the command palette) to write a **redacted** JSON snapshot of recent diagnostics next to the process working directory for bug reports.
Then run `/ report-issue` to open the GitHub issue form with triage guidance.

## Environment

| Var                       | Effect                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `KITSUNE_DEBUG=1`         | Enable debug JSON logs to stderr                                  |
| `KUNAI_DISCORD_CLIENT_ID` | Discord application id for optional `presenceProvider: "discord"` |

## Common Issues

**mpv IPC / bridge on Windows**

Kunai must drive the **same** native `mpv.exe` binary it spawned: IPC uses a Bun duplex **named pipe** (`//./pipe/kunai-mpv-…`), not your WSL Linux socket unless you run Kunai **inside** WSL. Player diagnostics will mention `ipc-bootstrap` with extra hints (`--debug` / `KITSUNE_DEBUG=1` logs structured `ipcTransport` / `bootstrapMs`). See [.docs/cli-reference.md](./cli-reference.md#mpv-bridge-script-persistent-autoplay).

**No stream resolved**

Try a different provider from the shell picker, use provider fallback, or change the default provider in settings.

**Downloads are enabled but jobs do not start**

Install `ffmpeg`, rerun `kunai --setup`, and confirm downloads are enabled.

**Subtitles are missing or not selectable**

Open the subtitle picker and check whether the stream is hard-sub-only, has soft-sub inventory for your language, or has unknown subtitle availability. Provider hard-subs and external soft subtitles are tracked separately.

**Discord presence does not appear**

Presence is off by default. Enable `presenceProvider: "discord"` in settings/config, provide `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`, and install the optional `discord-rpc` package in source checkouts. If any piece is missing, Kunai records one diagnostics event and avoids repeated retries until restart.

**Playback position feels wrong**

Next, previous, replay, source change, and picker-launched unwatched episodes should start from the beginning and leave the manual `Ctrl+R` resume prompt available in mpv when history exists. Continue, reload/recover, and quality change should keep the current position.

**Anime playback broke after an upstream change**

Check the invariants in [`packages/providers/src/allmanga/api-client.ts`](../packages/providers/src/allmanga/api-client.ts) against the current ani-cli behavior before changing anything.
