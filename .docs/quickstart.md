# Kunai — Quickstart

Use this doc for setup, local execution, and common environment issues. Architecture and file ownership live elsewhere.

## Prerequisites

- Bun `v1.1+`
- `mpv` in `PATH`
- Playwright Chromium for **embedded** providers (browser scrape); API-only anime sources may still work without it — Kunai warns at startup if the browser is missing
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

## CLI flags

Full tables, mpv passthrough flags, and “in-shell only” behavior are documented in **[cli-reference.md](./cli-reference.md)** (canonical for MDX sites).

Summary:

| Flag | Short | Notes |
| ---- | ----- | ----- |
| `--search` | `-S` | Pre-fill query |
| `--id` / `--type` | `-i` / `-t` | TMDB bootstrap: `-t` is `movie` or `series` |
| `--anime` | `-a` | Anime mode |
| `--minimal` / `--quick` | `-m` / `-q` | Session shell chrome; `-q` with `-S` also auto-picks first result |
| `--jump` | | With `-S`, auto-pick *n*th result (1-based) |
| `--debug` | | Verbose logging |

Use `/ export-diagnostics` in the shell (or the command palette) to write a **redacted** JSON snapshot of recent diagnostics next to the process working directory for bug reports.

## Environment

| Var               | Effect                           |
| ----------------- | -------------------------------- |
| `KITSUNE_DEBUG=1` | Enable debug JSON logs to stderr |

## Common Issues

**mpv IPC / bridge on Windows**

Kunai must drive the **same** native `mpv.exe` binary it spawned: IPC uses a Bun duplex **named pipe** (`//./pipe/kunai-mpv-…`), not your WSL Linux socket unless you run Kunai **inside** WSL. Player diagnostics will mention `ipc-bootstrap` with extra hints (`--debug` / `KITSUNE_DEBUG=1` logs structured `ipcTransport` / `bootstrapMs`). See [.docs/cli-reference.md](./cli-reference.md#mpv-bridge-script-persistent-autoplay).

**Playwright cannot find Chromium**

```sh
bunx playwright install chromium
```

**No stream resolved**

Try a different provider from the shell picker or change the default provider in settings.

**Anime playback broke after an upstream change**

Check the invariants in [`packages/providers/src/allmanga/api-client.ts`](../packages/providers/src/allmanga/api-client.ts) against the current ani-cli behavior before changing anything.
