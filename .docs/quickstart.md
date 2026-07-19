# Kunai — Quickstart

Use this doc for setup, local execution, and common environment issues. Architecture and file ownership live elsewhere.

## Prerequisites

- Bun `>=1.3.9` for source installs during beta
- `mpv` in `PATH`
- Kitty/Ghostty for native Kitty poster previews
- `chafa` for poster previews in Windows Terminal/WezTerm/other terminals
- ImageMagick (`magick`) if you want Kitty/Ghostty non-PNG poster conversion
- `yt-dlp` for YouTube playback and downloads/offline queue (must be on `PATH` for YouTube resolve/play and when downloads are enabled)
- `ffprobe` optional—used only for quick validation of finished files, not downloading

Deeper reference for terminal graphics, env overrides, and testing: [.docs/poster-image-rendering.md](poster-image-rendering.md).

Install runtime tools:

```sh
# Linux (Arch)
sudo pacman -S mpv yt-dlp chafa imagemagick

# Linux (Debian/Ubuntu)
sudo apt install mpv yt-dlp chafa imagemagick

# macOS (Homebrew)
brew install mpv yt-dlp chafa imagemagick
```

Windows options:

- `winget` (recommended): install `mpv`, `yt-dlp`, `chafa` (`winget install hpjansson.Chafa`), and ImageMagick (`winget install ImageMagick.ImageMagick`); add `ffprobe` separately if you want post-download validation
- Chocolatey: `choco install mpv yt-dlp chafa imagemagick`
- Scoop: `scoop install mpv yt-dlp chafa imagemagick`

Kunai is Bun-first in beta. A Node/npm-only source checkout is not supported because the CLI uses Bun runtime APIs directly. Packaged binaries are the preferred future path for users who should not need to install Bun manually.

## Setup

```sh
git clone <repo>
cd kunai
bun install
bun run link:global   # optional: installs local CLI command
```

Provider research scratchpads live in `apps/experiments` and are **not** installed by
default (keeps Playwright and other lab deps out of the main workspace). Opt in when
you need them:

```sh
bun run experiments:install
bun run experiments:list
```

Shared dependency versions are managed with [Bun catalogs](https://bun.sh/docs/pm/catalogs)
in the root `package.json` (`catalog:`, `catalog:lint`, `catalog:web`, …). Bump
stable (`latest`) versions there, then run `bun install`. Lint/format tools live
at the root via `catalog:lint`; package scripts resolve them through the
workspace.

## Run

```sh
bun run dev
bun run dev -- -S "Attack on Titan"
bun run dev -- -i 1429 -t series
bun run dev -- -i 438631 -t movie
bun run dev -- -a
bun run dev -- --youtube -S "lofi beats"
bun run dev -- -m
bun run dev -- -S "Dune" --jump 1
bun run dev -- -S "Dune" -q
bun run dev -- --debug
kunai -S "Dune"   # after bun run link:global
```

Inside the shell, press `m` to cycle `series -> anime -> YouTube`, or run
`/youtube` / `/yt` to switch straight into the YouTube lane. YouTube search can
use Invidious/Piped metadata, but playback needs `yt-dlp` on `PATH`. Default
YouTube quality is **1080p** (Settings → Language → YouTube quality); playback
streams via mpv + yt-dlp without writing a video file to disk. Use download
(`d`) to save `.mp4` files offline.

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

Use `/export-diagnostics` in the shell (or the command palette) to write a **redacted** JSON snapshot of recent diagnostics next to the process working directory for bug reports.
Then run `/report-issue` to open the GitHub issue form with triage guidance.

Browse filters can be typed directly in search, for example:

```text
type:anime year:2026 rating:7 genre:isekai audio:ja subtitles:en
```

Filters stack in one structured state. Unsupported filters are reported as local/unsupported evidence instead of being silently treated as provider-applied.

## Environment

| Var                           | Effect                                                            |
| ----------------------------- | ----------------------------------------------------------------- |
| `KITSUNE_DEBUG=1`             | Enable debug JSON logs to stderr                                  |
| `KUNAI_DISCORD_CLIENT_ID`     | Discord application id for optional `presenceProvider: "discord"` |
| `KUNAI_VIDEASY_SESSION_TOKEN` | Optional user-provided Videasy browser session token for VidKing  |
| `KUNAI_RELAY_BASE_URL`        | Optional user-owned provider RPC relay base URL for metadata APIs |
| `KUNAI_RELAY_TOKEN`           | Optional bearer token for the user-owned provider relay           |

VidKing may report `Videasy requires a valid browser session` when Videasy's
guarded API requires a session created by the website. Kunai can use a token you
explicitly provide through `/settings` or `KUNAI_VIDEASY_SESSION_TOKEN`; it does
not try to bypass browser challenges or solve Turnstile automatically. Set
`Videasy app id` to `vidking` for vidking.net sessions or `bc-frontend` for
Bitcine sessions.

**Mint a session (one-time, then reuse across episodes)**

```sh
cd apps/experiments
bun run videasy:mint tv 61700 1 3   # opens bitcine.tv; complete Turnstile if prompted
```

From a fresh clone, run `bun run experiments:install` once at the repo root before
using `apps/experiments` scripts.

Or from DevTools while [bitcine.tv](https://www.bitcine.tv) playback works:

1. Network → filter `auth/session` or `sources-with-title`
2. Copy `token` from the **200** `POST https://api.videasy.net/auth/session` JSON body, **or** the `x-session-token` request header on `sources-with-title`
3. `/settings` → **Videasy session token** → paste; **Videasy app id** → `bc-frontend` for Bitcine (or `vidking` for vidking.net)

Verify the API gate (no token → blocked):

```sh
curl -sS "https://api.videasy.net/mb-flix/sources-with-title?tmdbId=61700&mediaType=tv&seasonId=1&episodeId=3&title=test"
# {"error":"session_missing"}
```

### Provider Geo Relay

If provider metadata APIs are geo-blocked from your network (for example
AllAnime returning `NEED_CAPTCHA`), run a user-owned relay instead of routing
video through Kunai. The relay handles small provider API/search/source JSON;
mpv still fetches the final CDN URL directly.

Local smoke:

```sh
# Terminal 1
bun run dev:relay

# Terminal 2
export KUNAI_RELAY_BASE_URL=http://127.0.0.1:8787
bun run test:live:relay-allanime
```

For internet deployments, see `apps/relay-server/README.md`. Leave
`providerRelay.baseUrl` empty to use direct provider fetches only.

## Common Issues

**mpv IPC / bridge on Windows**

Kunai must drive the **same** native `mpv.exe` binary it spawned: IPC uses a Bun duplex **named pipe** (`//./pipe/kunai-mpv-…`), not your WSL Linux socket unless you run Kunai **inside** WSL. Player diagnostics will mention `ipc-bootstrap` with extra hints (`--debug` / `KITSUNE_DEBUG=1` logs structured `ipcTransport` / `bootstrapMs`). See [.docs/cli-reference.md](./cli-reference.md#mpv-bridge-script-persistent-autoplay).

**No stream resolved**

Try a different provider from the shell picker, use provider fallback, or change the default provider in settings.

**Downloads are enabled but jobs do not start**

Install `yt-dlp` on your `PATH`, rerun `/setup` if needed, and confirm downloads are enabled. Optional: add `ffprobe` to your `PATH` for post-download validation.

If a completed job says it needs attention, the video may already be playable while a subtitle or artwork sidecar needs repair. Use `/downloads` and retry the job; Kunai repairs sidecars without redownloading the whole video when the artifact is still present.

**Subtitles are missing or not selectable**

Open the subtitle picker and check whether the stream is hard-sub-only, has soft-sub inventory for your language, or has unknown subtitle availability. Provider hard-subs and external soft subtitles are tracked separately.

**Discord presence does not appear**

Presence is off by default. Enable `presenceProvider: "discord"` in settings/config, provide `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`, and install the optional `discord-rpc` package in source checkouts. If any piece is missing, Kunai records one diagnostics event and avoids repeated retries until restart.

**Playback position feels wrong**

Next, previous, replay, source change, and picker-launched unwatched episodes should start from the beginning and leave the manual `Ctrl+R` resume prompt available in mpv when history exists. Continue, reload/recover, and quality change should keep the current position.

**Anime playback broke after an upstream change**

Check the invariants in [`packages/providers/src/allmanga/api-client.ts`](../packages/providers/src/allmanga/api-client.ts) against the current ani-cli behavior before changing anything.

## Docs site deploy

The public docs app lives in `apps/docs`. Set `DOCS_SITE_URL` to your production origin (for example `https://docs.kunai.example`) before `next build` so canonical URLs, sitemap, Open Graph, and `llms.txt` resolve correctly.

```sh
DOCS_SITE_URL=https://docs.kunai.example bun run --cwd apps/docs build
```

Before a production docs deploy, run the full docs gate locally:

```sh
bun run --cwd apps/docs generate
bun run --cwd apps/docs scripts/check-codegen-freshness.ts
bun run --cwd apps/docs test
bun run --cwd apps/docs build
```

Optional Lighthouse audit (local only — not gated in CI):

```sh
DOCS_SITE_URL=https://docs.kunai.example bun run --cwd apps/docs lighthouse:docs
```

Troubleshooting pages emit `FAQPage` JSON-LD from `docs/troubleshooting-symptoms.yaml`.

Set `DOCS_SITE_URL` to the origin you are auditing so canonical and SEO checks match production.
