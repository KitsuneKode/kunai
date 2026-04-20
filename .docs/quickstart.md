# KitsuneSnipe — Quickstart

Use this doc for setup, local execution, and common environment issues. Architecture and file ownership live elsewhere.

## Prerequisites

- Bun `v1.1+`
- `mpv` in `PATH`
- `fzf` in `PATH`
- Kitty graphics protocol support if you want inline posters

## Setup

```sh
git clone <repo>
cd kitsunesnipe
bun install
bunx playwright install chromium
```

## Run

```sh
bun run index.ts
bun run index.ts -S "Attack on Titan"
bun run index.ts -i 1429 -t series
bun run index.ts -i 438631 -t movie
bun run index.ts -a
bun run index.ts --debug
```

## Dev Checks

```sh
bun tsc --noEmit
./node_modules/.bin/oxlint .
./node_modules/.bin/oxfmt --check .
bun run test
```

Do not use `bun test` directly. The repo currently has local `oxlint` and `oxfmt` binaries but does not define `bun run lint` or `bun run format` scripts.

## CLI Flags

| Flag         | Short | Description               |
| ------------ | ----- | ------------------------- |
| `--search`   | `-S`  | Pre-fill search query     |
| `--id`       | `-i`  | TMDB ID and skip search   |
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

**`fzf` is missing**

Install it with your package manager.

**No stream resolved**

Try a different provider from the post-episode menu or change the default provider in settings.

**Anime playback broke after an upstream change**

Check the invariants in [`src/providers/anime-base.ts`](../src/providers/anime-base.ts) against the current ani-cli behavior before changing anything.
