# Kunai — Quickstart

Use this doc for setup, local execution, and common environment issues. Architecture and file ownership live elsewhere.

## Prerequisites

- Bun `v1.1+`
- `mpv` in `PATH`
- Kitty graphics protocol support if you want inline posters

## Setup

```sh
git clone <repo>
cd kunai
bun install
bunx playwright install chromium
bun run link:global   # optional: installs local CLI command
```

## Run

```sh
bun run dev
bun run dev -- -S "Attack on Titan"
bun run dev -- -i 1429 -t series
bun run dev -- -i 438631 -t movie
bun run dev -- -a
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

## CLI Flags

| Flag         | Short | Description               |
| ------------ | ----- | ------------------------- |
| `--search`   | `-S`  | Pre-fill search query     |
| `--id`       | `-i`  | TMDB ID bootstrap         |
| `--type`     | `-t`  | `movie` or `series`       |
| `--anime`    | `-a`  | Start in anime mode       |
| `--season`   |       | Initial season            |
| `--episode`  |       | Initial episode           |
| `--provider` | `-p`  | Override provider         |
| `--debug`    |       | JSON debug logs to stderr |

## Environment

| Var               | Effect                           |
| ----------------- | -------------------------------- |
| `KITSUNE_DEBUG=1` | Enable debug JSON logs to stderr |

## Common Issues

**Playwright cannot find Chromium**

```sh
bunx playwright install chromium
```

**No stream resolved**

Try a different provider from the shell picker or change the default provider in settings.

**Anime playback broke after an upstream change**

Check the invariants in [`apps/cli/src/services/providers/definitions/allanime-family.ts`](../apps/cli/src/services/providers/definitions/allanime-family.ts) against the current ani-cli behavior before changing anything.
