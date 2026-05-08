# Kunai

Terminal-first streaming for anime, series, and movies.

Kunai lets you browse in a fullscreen TUI, resolve provider streams, and hand playback to `mpv` while keeping session context in the shell.

## What It Is

- Search and browse from a keyboard-native shell UI
- Pick provider, season, episode, source, quality, subtitle, and audio mode
- Launch and control playback in `mpv`
- Keep local watch history and resume state (SQLite-backed)
- Use fallback/recovery and diagnostics when providers drift

## What You Need

- Bun `>=1.3.9` (current beta runtime path)
- `mpv` on your `PATH` (**required**)
- Playwright Chromium (**recommended**, required for browser-backed providers)
- Kitty/Ghostty terminal (**optional**, for inline poster previews in browse/discover)
- ImageMagick `magick` (**optional**, improves poster compatibility for non-PNG sources)
- Discord + `discord-rpc` (**optional**, only for presence)
- `ffmpeg` (**optional**, currently for planned download/offline flows)

Install browser runtime if needed:

```bash
bunx playwright install chromium
```

## Install And Run

### From source (recommended during beta)

```bash
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bun run link:global
kunai
```

### Common launch commands

```bash
kunai
kunai -a
kunai -S "Dune"
kunai -S "Breaking Bad"
kunai -i 438631 -t movie
kunai --debug
```

## Core Flow

```text
kunai
  -> search title
  -> pick season/episode
  -> resolve provider stream
  -> watch in mpv
  -> return to shell for next/replay/provider/diagnostics/history
```

## Discover And Recommendations

- Run `/ discover` to open recommendation + trending sections
- Press `Ctrl+T` in browse mode to reload trending discovery lists
- Discover uses cached recommendation/catalog responses for deterministic UX

## Controls

### Global shell

- `/`: command palette
- `Esc`: close/back
- `?`: help
- `q`: quit/stop flow

### Playback flow

- `n` / `p`: next/previous episode
- `k`: source/quality picker
- `o`: provider picker
- `b`: skip active intro/recap/credit segment
- `r`: reload/recover current stream
- `f`: fallback provider
- `Ctrl+R` (inside `mpv`): manual resume prompt when history exists

## Diagnostics And Issue Reports

- Run with `--debug` for verbose traces
- Use `/ export-diagnostics` to generate a redacted local JSON snapshot
- Use `/ report-issue` to open issue triage guidance
- Open Diagnostics/About panels to confirm startup capabilities (`mpv`, `ffmpeg`, Kitty, `magick`)

## Provider Caveats (Beta)

- Providers are third-party integrations and may drift
- Availability can vary by title, region, subtitle track, or source mirror
- Some streams are hard-sub only or expose incomplete subtitle metadata
- Recovery paths are intentional: retry, source switch, provider fallback, diagnostics export

## Architecture At A Glance

```text
apps/cli/src/main.ts      -> canonical runtime entrypoint
apps/cli/index.ts         -> compatibility wrapper only
apps/cli/src/app-shell/*  -> shell UI
apps/cli/src/app/*        -> app policy/session phases
apps/cli/src/services/*   -> orchestration services
apps/cli/src/infra/*      -> player/ipc/filesystem/runtime mechanics
```

## Beta Note

Kunai is actively hardened for public beta publish. Reliability, deterministic behavior, and diagnosable failure paths are prioritized over broad feature expansion.

## Beta Publish Status

### Stable now

- Typecheck, lint, tests, package checks, and release dry-run are green
- Canonical runtime is `apps/cli/src/main.ts` with deterministic shell flow
- Watch history, diagnostics, provider fallback, and discover/recommendation are integrated
- Optional capability guardrails now cover `mpv`, `ffmpeg`, Kitty/Ghostty, and `magick`

### Explicitly remaining before beta publish sign-off

- Live verify autoplay advance at natural EOF for TMDB series and AllAnime
- Complete legacy quarantine move out of active CLI tree into `archive/legacy/**` reference-only paths
- Expand/keep architecture boundary tests to block regressions into legacy/experiments imports
- Keep package boundaries strict: no premature large extraction outside stable contracts

## Recommended Execution Passes (From Now)

1. **Publish hygiene pass**: metadata, README, package tarball, release dry-run
2. **Legacy quarantine pass**: move legacy references out of active CLI tree
3. **Boundary hardening pass**: enforce import fences and app-shell/service boundaries
4. **Live reliability pass**: validate autoplay/provider drift handling on real sessions
5. **Beta release pass**: final checks, changelog, publish

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or distribute video content. Streams and related assets are served by non-affiliated third-party providers. Use responsibly and in accordance with applicable laws and service terms.
