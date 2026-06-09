---
title: Feature Tour
description: Every Kunai capability — what works, what is experimental, and what the shell can do.
---

Kunai is a terminal-first media shell. It resolves media streams from third-party
providers, hands playback to `mpv`, and keeps recovery, offline, and diagnostics
in the same session.

## Launch Entry Points

| Flag                               | What it does                                          |
| ---------------------------------- | ----------------------------------------------------- |
| `kunai`                            | Open the shell — search, browse, or pick from history |
| `kunai -S "Title"`                 | Search and show results                               |
| `kunai -S "Title" --jump 1`        | Search, auto-select first result, skip browse UI      |
| `kunai -S "Title" -q`              | Quick mode — same as `--jump 1` with search           |
| `kunai -a -S "Anime"`              | Anime mode (uses anime providers)                     |
| `kunai --id 438631 -t movie`       | Open a specific TMDB ID directly                      |
| `kunai --continue`                 | Jump to the newest unfinished history entry           |
| `kunai --history`                  | Open watch history first                              |
| `kunai --offline`                  | Open completed offline library first                  |
| `kunai --discover`                 | Open recommendations first                            |
| `kunai --calendar`                 | Open release calendar first                           |
| `kunai --random`                   | Open random picks tray first                          |
| `kunai --setup`                    | Run setup wizard                                      |
| `kunai --download`                 | Open download queue                                   |
| `kunai --zen`                      | Minimal chrome mode (bare terminal, ani-cli style)    |
| `kunai --zen --offline`            | Minimal chrome + offline library                      |
| `kunai --debug`                    | Verbose logging to `./logs.txt`                       |
| `kunai --debug-json`               | Debug + structured JSON event stream                  |
| `kunai --debug-session`            | Debug + full session trace                            |
| `kunai --jump N`                   | Resume or seek to episode N (1-based)                 |
| `kunai --mpv-debug`                | Verbose mpv logging                                   |
| `kunai --mpv-clean`                | Ignore user mpv config                                |
| `kunai --dry-run`                  | Print what would happen, change nothing               |
| `kunai --install-protocol-handler` | Register `kunai://` URL handler                       |

## Shell Commands

Press `/` to open the context-aware command palette. All commands adapt to the
current context — some are only available during playback, others from any state.

| Command                 | Aliases                              | Available       | Action                                   |
| ----------------------- | ------------------------------------ | --------------- | ---------------------------------------- |
| `/search`               | `find`                               | post-playback   | Start a new search                       |
| `/history`              | `resume`, `recent`                   | always          | Open watch history                       |
| `/continue`             | `c`                                  | always          | Open unfinished and recent progress      |
| `/library`              | `offline`                            | always          | Browse completed offline library         |
| `/downloads`            | `download-jobs`, `jobs`              | always          | Manage queued, running, failed downloads |
| `/download`             | `save`                               | during playback | Queue current item for offline           |
| `/playlist`             | `queue`, `up-next`                   | overlay/post    | View and manage up-next queue            |
| `/playlist-add`         | `add-to-playlist`                    | during playback | Queue current for sequential playback    |
| `/watchlist`            | `wl`                                 | overlay/post    | View and manage watchlist                |
| `/favorites`            | `favs`                               | always          | View favorite titles                     |
| `/stats`                | `statistics`                         | overlay/post    | Local watch stats and streak             |
| `/notifications`        | `inbox`, `alerts`                    | always          | Review new episodes and queue recovery   |
| `/discover`             | `recommendations`, `recs`, `suggest` | post-playback   | Personalized recommendations             |
| `/random`               | `roulette`, `pick-for-me`            | post-playback   | Random recommendation tray               |
| `/surprise`             | `surprise-me`                        | post-playback   | Surprise pick without autoplay           |
| `/trending`             | `popular`                            | always          | Cached trending list                     |
| `/calendar`             | `schedule`, `airing`, `releases`     | post-playback   | Anime and series release schedule        |
| `/anime-calendar`       | `anime-schedule`                     | post-playback   | Calendar filtered to anime               |
| `/series-calendar`      | `tv-calendar`                        | post-playback   | Calendar filtered to series              |
| `/recover`              | `fix`, `repair`                      | during playback | Refresh stream and resume                |
| `/recompute`            | `refresh-sources`, `bypass-cache`    | during playback | Bypass cache, re-resolve all sources     |
| `/fallback`             | `next-provider`, `f`                 | during playback | Try next compatible provider             |
| `/replay`               | `restart`                            | post-playback   | Restart current item from beginning      |
| `/source`               | `sources`, `tracks`                  | during playback | Open source/server selection             |
| `/quality`              | `qualities`, `variant`               | during playback | Open quality selection                   |
| `/audio`                | `dub`, `language`                    | during playback | Open audio track selection               |
| `/subtitle`             | `subtitles`, `subs`                  | during playback | Open subtitle selection                  |
| `/provider`             | `switch-provider`                    | overlay/post    | Open provider picker                     |
| `/pick-episode`         | `episodes`                           | during playback | Open episode picker                      |
| `/next`                 | `n`                                  | during playback | Advance to next episode                  |
| `/previous`             | `prev`, `p`                          | during playback | Go to previous episode                   |
| `/next-season`          | `season`                             | post-playback   | Jump to next season                      |
| `/toggle-mode`          | `anime`                              | post-playback   | Switch between anime and series mode     |
| `/toggle-autoplay`      | `autoplay`                           | during playback | Pause/resume autoplay for this chain     |
| `/toggle-autoskip`      | `autoskip`, `skip`                   | during playback | Pause/resume auto-skip                   |
| `/stop-after-current`   | `one-more`                           | during playback | Stop after current episode               |
| `/mark-anime`           | `set-anime`                          | during playback | Reclassify title as anime in history     |
| `/mark-series`          | `set-series`                         | during playback | Reclassify title as series in history    |
| `/image-pane`           | `preview`, `poster`                  | when supported  | Toggle image/details pane                |
| `/memory`               | `mem`                                | during playback | Show temporary memory strip              |
| `/share`                | `share-code`                         | during playback | Copy watch link to clipboard             |
| `/watch`                | `open-share`                         | always          | Play a title from a share code           |
| `/settings`             | `config`, `prefs`                    | always          | Open settings                            |
| `/presence`             | `discord`, `rpc`                     | always          | Discord Rich Presence settings           |
| `/filters`              | `advanced-search`                    | always          | Show search filter syntax                |
| `/setup`                | `onboarding`                         | always          | Run setup wizard                         |
| `/diagnostics`          | `logs`, `debug`                      | always          | Open diagnostics panel                   |
| `/export-diagnostics`   | `export-logs`                        | always          | Write redacted support bundle            |
| `/report-issue`         | `bug-report`                         | always          | Open GitHub issue page                   |
| `/docs`                 | `documentation`, `manual`            | always          | Open documentation                       |
| `/update`               | `upgrade`                            | always          | Check for new version                    |
| `/help`                 | `shortcuts`, `?`                     | always          | Show help                                |
| `/about`                | `version`                            | always          | Show version and capabilities            |
| `/clear-cache`          | `purge-cache`                        | always          | Remove cached stream URLs                |
| `/clear-history`        | `reset-history`                      | always          | Remove all local history                 |
| `/sync`                 | `integrations`                       | overlay/post    | Open sync settings                       |
| `/sync-connect-anilist` | `anilist`                            | always          | Link AniList account                     |
| `/sync-connect-tmdb`    | `tmdb`                               | always          | Link TMDB account                        |
| `/sync-disconnect`      | `unlink-sync`                        | always          | Remove linked accounts                   |
| `/quit`                 | `exit`, `q`                          | any             | Exit Kunai                               |

## Active Providers

These five provider modules are registered and loadable. Provider availability
and quality drift over time — recovery commands are part of normal usage.

| Provider   | ID           | Media         | Status    | Recommended | Notes                                                  |
| ---------- | ------------ | ------------- | --------- | ----------- | ------------------------------------------------------ |
| Videasy    | `videasy`    | movie, series | active    | no          | Direct API resolver, local-only, WASM-based decryption |
| VidLink    | `vidlink`    | movie, series | active    | yes         | Browserless HLS, multi-lang subtitles, relay-safe      |
| Rivestream | `rivestream` | movie, series | candidate | yes         | MurmurHash-based, relay-safe                           |
| AllManga   | `allanime`   | anime         | active    | no          | Anime-only, AllManga-compatible client                 |
| Miruro     | `miruro`     | anime         | candidate | yes         | XOR/gzip pipe API, relay-safe                          |

### Provider Details

**Videasy** (`videasy`) is the most mature provider for movies and series. It
uses a direct API with WASM-based decryption. Local-only — requires the Kunai
process to run on the same machine. Session token supports authenticated
endpoints. Falls back through VidKing-compatible flavors.

**VidLink** (`vidlink`) is the recommended movie/series provider. Browserless
direct HLS resolution with multi-language subtitles. Relay-safe — can run on
remote infrastructure. No session token or captcha required. Relies on
enc-dec.app for TMDB id encryption.

**Rivestream** (`rivestream`) is a candidate provider for movies and series.
Generates MurmurHash signatures natively. Relay-safe. Still under evaluation
for production readiness.

**AllManga** (`allanime`) is the anime provider. Uses local fetch/decode logic
for search, catalog, and source resolution. Browserless. Local-only. Named
`allanime` internally for ani-cli parity while the display name is AllManga.

**Miruro** (`miruro`) is a candidate anime provider. Uses pipe API with XOR/gzip
decryption. Relay-safe. May hit Cloudflare rate limits if called too frequently.

### Providers NOT registered in the active engine

- **Cineby** (`cineby`) — a Videasy flavor wrapper. Not registered as a
  standalone provider in the container. Available for research through the
  `@kunai/providers` package as `cinebyProviderModule`.
- **VidKing** (`vidking`) — legacy name for Videasy. Kept as a config/cache
  migration alias. Do not use in new code.

## What Works Well

- Search by title with TMDB-backed metadata
- Movie and series playback through Videasy and VidLink
- Anime playback through AllManga
- Watch history with resume support
- Continue Watching with unfinished/new episode detection
- Release calendar with cached schedule data (anime + series)
- Recommendations and discovery surfaces
- Offline downloads via yt-dlp with artifact validation
- Library browsing from local SQLite (no provider calls needed)
- Diagnostics panel and redacted support bundle export
- GitHub issue reporting with prefilled context
- Discord Rich Presence with per-session activity
- AniList and TMDB sync for watch progress
- Share codes for sharing watch links
- Cache-first stream resolution with health checks
- Provider fallback chain
- Recovery and recompute flows for stale streams

## What Is Experimental / Candidate

- Rivestream provider — candidate status, not yet production-proven
- Miruro provider — candidate status, Cloudflare rate limits observed
- Zen mode (`--zen`) — minimal chrome, still settling
- Notifications — inbox system active, alert delivery maturing
- Playlist queue — durable playlist service active, multi-session recovery being validated

## What Is NOT Supported

- Browser-based scraping (Playwright/headless) — deprecated, archive-only
- Cloud proxy infrastructure for stream resolution
- First-party streaming service authentication or scraping
- Content hosting or redistribution
- Native GUI outside the terminal (no Electron, no TUI framework beyond Ink)
- Windows/macOS native installers (runs where Bun and mpv are available)
- Automatic provider health degradation from local network failures
- Silent mode-switching between online and offline
- Autoplay from imported playlists
- Stream URL storage in unredacted support bundles

## Hotkeys

| Context          | Keys                | Action                             |
| ---------------- | ------------------- | ---------------------------------- |
| Anywhere         | `/`                 | Open context-aware command palette |
| Browse results   | `Enter`             | Open or play selected result       |
| Browse results   | `Shift+Enter` / `i` | Open title details                 |
| Browse results   | `Ctrl+F`            | Focus filters                      |
| Browse results   | `Ctrl+T`            | Refresh trending                   |
| Browse results   | `Ctrl+D`            | Queue for download                 |
| Browse / pickers | `Esc`               | Clear, close, or go back           |
| Playback         | `r`                 | Recover current stream             |
| Playback         | `f`                 | Try next compatible provider       |
| Playback         | `d`                 | Queue for download                 |
| Playback         | `k`                 | Open tracks/source/quality         |
| Playback         | `n` / `p`           | Next / previous episode            |
| Playback         | `a` / `u`           | Toggle autoplay / autoskip         |

## Diagnostics Flow

```
/diagnostics        → runtime panel with provider timeline
/export-diagnostics → redacted JSON bundle (no URLs, no tokens)
/report-issue       → GitHub issue page with bundle guidance
--debug             → verbose startup and runtime logging
--debug-json        → structured JSONL event stream
--debug-session     → full session trace
```

## Platform Support

| Platform | Playback | Downloads        | Poster previews |
| -------- | -------- | ---------------- | --------------- |
| Linux    | mpv      | yt-dlp + ffprobe | Kitty / chafa   |
| macOS    | mpv      | yt-dlp + ffprobe | chafa           |
| Windows  | mpv      | yt-dlp           | chafa (limited) |

## Storage Architecture

| Store    | Type      | Contents                                                  |
| -------- | --------- | --------------------------------------------------------- |
| Config   | JSON file | `~/.config/kunai/config.json`, provider overrides         |
| Data DB  | SQLite    | History, lists, playlists, notifications, downloads       |
| Cache DB | SQLite    | Stream URLs, provider health, source inventory, schedules |
| Logs     | File      | `./logs.txt` when `--debug` is enabled                    |
