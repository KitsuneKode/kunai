<div align="center">

# Kunai

**A cinematic terminal streaming companion for anime, series, and movies.**

[![License](https://img.shields.io/github/license/kitsunekode/kunai?style=flat-square&color=black)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-f472b6?style=flat-square)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20windows-555?style=flat-square)](#prerequisites)
[![Beta](https://img.shields.io/badge/status-beta-orange?style=flat-square)](#beta-note)

![Kunai Terminal Demo](./apps/cli/test/vhs/browse-shell.gif)

_The terminal can have nice things._

</div>

---

Kunai is a terminal-first playback app that lets you search, choose, resume, and watch without turning your shell into a sad little form from 1998.

It finds playable direct-provider streams, resolves subtitles, opens `mpv`, keeps watch history, supports anime episode flow, and brings you back to the same shell when playback ends. Think keyboard-native streaming: fast like a CLI, structured like a real app, and polished enough that you do not have to apologize for using a terminal.

## Motto

**Just because it runs in a TUI does not mean it has to leave the good features outside the door.**

Kunai is built around that idea: anime, shows, movies, subtitles, resume, intro skipping, diagnostics, provider recovery, and `mpv` handoff should feel like one deliberate experience, not a pile of prompts wearing a trench coat.

## Inspired By

Kunai is inspired by:

- **ani-cli**, for proving how magical fast terminal anime playback can feel.
- **Netflix**, for the expectation that browsing, continuing, subtitles, episodes, and playback should feel connected.

Kunai is not trying to be a browser clone. It is what happens when those ideas are rebuilt for people who live in the terminal.

## Why Kunai?

- **Search from the shell**: browse anime, movies, and series from a fullscreen TUI.
- **Pick the exact watch target**: choose provider, season, episode, subtitle behavior, and anime sub/dub preference from structured selectors.
- **Open in `mpv`**: resolve the stream and hand it to a real video player instead of trapping playback in a web page.
- **Skip the boring bits**: AniSkip and IntroDB timing can drive automatic intro, recap, credit, and preview skipping where metadata is available.
- **Resume cleanly**: SQLite-backed watch history remembers progress and gives you a direct way back in.
- **Recover without panic**: provider fallback, stream refresh, diagnostics, and in-process `mpv` reconnects help keep failures understandable.
- **Share presence only if you choose**: optional first-party presence settings are off by default and never expose stream URLs.
- **Stay keyboard-native**: global commands, contextual hotkeys, compact overlays, and post-playback actions keep the flow moving.

## The Experience

```text
kunai
  -> search for a title
  -> inspect results
  -> choose season and episode
  -> pick subtitles or audio mode
  -> resolve a provider stream
  -> watch in mpv
  -> auto-skip intro when timing metadata exists
  -> return to the shell for next episode, replay, history, diagnostics, or a new search
```

No accounts. No browser tab pile. No "where did my episode picker go?" energy.

## Quick Start

```bash
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bun run link:global
kunai
```

### Prerequisites

- Bun `>=1.3.9` for source installs during beta
- `mpv` on your `PATH`
- Optional: Playwright Chromium for browser-backed providers

```bash
bunx playwright install chromium
```

Kunai currently uses Bun APIs directly in the CLI runtime, including process, socket, and install flows. A plain Node/npm-only source checkout is not a supported beta path. The intended future onboarding path for non-developers is a packaged binary so users do not need to install Bun by hand.

## Common Commands

```bash
kunai
kunai -a
kunai -S "Dune"
kunai -S "Breaking Bad"
kunai -i 438631 -t movie
kunai --debug
```

## Controls

### Global TUI

| Key   | Action                               |
| ----- | ------------------------------------ |
| `/`   | Open the command palette             |
| `Esc` | Close the current overlay or go back |
| `?`   | Show help                            |
| `q`   | Quit or stop playback flow           |

### During Playback

When `mpv` is open, Kunai keeps a bridge alive so playback can still talk back to the shell.

| Key             | Action                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| `n` / `p`       | Request next or previous episode                                                    |
| `c`             | Continue from saved progress when the shell is waiting after playback               |
| `a`             | Resume autoplay from the saved point when available                                 |
| `k`             | Open stream or quality picker                                                       |
| `o`             | Open provider picker                                                                |
| `b`             | Skip the active intro/recap/credit segment manually                                 |
| `r`             | Reload or recover the current stream and continue playback                          |
| `f`             | Fallback to the next provider                                                       |
| `Ctrl+R` in mpv | Manually resume from saved progress when Kunai starts an episode from the beginning |

Navigation and manual replay start episodes from the beginning by default when a saved resume point exists; the mpv overlay offers the resume prompt instead of Kunai seeking automatically. Reload and quality changes keep the current playback position. Source changes restart the selected source and leave manual resume available.

Source, quality, subtitle, and provider availability comes from the resolved provider inventory. Hard-sub languages, soft-sub tracks, audio language, and unknown availability are shown separately where the provider exposes enough evidence.

## Optional Presence

Kunai has a first-party presence seam for local social status integrations. It is **off by default**.

- `presenceProvider: "off" | "discord"`
- `presencePrivacy: "full" | "private"`
- `presenceDiscordClientId`: optional Discord application id, or use `KUNAI_DISCORD_CLIENT_ID`

The Discord path uses an optional local `discord-rpc` package when available. If Discord, the package, or a client id is missing, Kunai records a diagnostics event and does not keep retrying during that process. Presence never includes stream URLs, provider URLs, headers, or subtitle URLs.

## Troubleshooting

| Symptom                      | What to try                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `mpv` missing                | Install `mpv` and make sure it is on `PATH`, then rerun Kunai.                                            |
| Provider exhausted           | Use fallback/provider picker, retry later, or export diagnostics if every compatible provider fails.      |
| Subtitle unavailable         | Check the subtitle picker; some streams are hardsub-only or expose no soft subtitles.                     |
| Hardsub-only playback        | Switch anime sub/dub preference or provider if you need a different language and the provider offers one. |
| Hard-to-debug playback issue | Run with `--debug`, then use `/ export-diagnostics` for a redacted JSON snapshot.                         |

## Developer Workflow

Kunai is a Bun-first monorepo.

```text
apps/cli        -> Ink TUI, session flow, mpv handoff
packages/core   -> provider contracts, resolver, cache policy
packages/providers -> direct-provider implementations
packages/storage -> SQLite paths, migrations, history, cache
```

Useful commands:

```bash
bun run dev
bun run dev -- -a
bun run typecheck
bun run lint
bun run fmt
bun run test
```

VHS terminal demos live in `apps/cli/test/vhs/`.

```bash
bun run --cwd apps/cli test:vhs:browse
bun run --cwd apps/cli test:vhs:help
bun run --cwd apps/cli test:vhs:launch
```

For a cinematic launch-video storyboard, shot checklist, and VHS/local-recorder capture plan, see [.docs/launch-video-playbook.md](.docs/launch-video-playbook.md).

## Beta Note

Kunai is under active development. Providers can drift, subtitle inventories can vary, and some flows may depend on third-party availability. The goal is not to pretend providers are stable forever; the goal is to make drift diagnosable and recovery humane.

## Disclaimer

Kunai is a client-side playback tool. It does not host, store, upload, mirror, seed, or distribute video content. Streams, manifests, subtitles, posters, metadata, and related assets are served by non-affiliated third-party providers.

If you believe specific content is infringing, direct DMCA notices to the actual hosting provider, not this repository. Use responsibly and in accordance with the laws and terms applicable in your jurisdiction.
