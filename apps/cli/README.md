# @kitsunekode/kunai

`@kitsunekode/kunai` is the published CLI package for Kunai.

Kunai is a terminal-first client that resolves third-party stream URLs and launches playback in `mpv`. It does not host, upload, mirror, seed, or distribute video content.

## Requirements

- **Node** on your `PATH` (this npm channel ships a Node launcher that spawns a platform binary — you do not need Bun)
- `mpv` on your `PATH` (required for playback)
- `yt-dlp` on your `PATH` for YouTube playback and when offline downloads are enabled
- `ffprobe` for optional verification of finished downloads only—not the downloader
- Built-in half-block poster fallback; Kitty/Ghostty/iTerm2/sixel when the terminal supports them
- Discord desktop app for Rich Presence (optional; local Unix-socket / Windows named-pipe IPC)

Native release binaries embed Bun and do **not** need a separate Bun or Node install. Prefer
`install.sh` / `install.ps1` when you want zero runtime prerequisites. This npm page is
for the package-manager channel only.

Poster subsystem and testing: repo root [.docs/poster-image-rendering.md](../../.docs/poster-image-rendering.md).

Install core tools:

```bash
# Linux (Arch)
sudo pacman -S mpv yt-dlp

# Linux (Debian/Ubuntu)
sudo apt install mpv yt-dlp

# macOS (Homebrew)
brew install mpv yt-dlp
```

Windows: `winget install mpv` (the process looks for a command named `mpv` / `mpv.exe`) and `winget install yt-dlp`. Add `ffprobe` (from FFmpeg) only if you want post-download validation.

## Install

```bash
npm install -g @kitsunekode/kunai
```

Optional platform binaries ship as optional dependencies. Diagnose PATH with `kunai doctor`.

Run:

```bash
kunai
kunai --setup
```

## Update and uninstall

Primary update path (channel-aware):

```bash
kunai upgrade
kunai upgrade --check
```

npm-native alternatives:

```bash
npm install -g @kitsunekode/kunai   # update
npm uninstall -g @kitsunekode/kunai # remove package
kunai uninstall                     # ownership-aware removal
kunai uninstall --purge             # also delete config/history/cache
```

If `kunai` is missing or shadowed after install, diagnose PATH and ownership:

```bash
kunai doctor
kunai doctor --json
type -a kunai                # bash: list every kunai on PATH
# or: which -a kunai
# zsh: whence -a kunai  (also which -a / type -a)
# PowerShell: Get-Command kunai -All
kunai install --force        # redownload/reverify; pin with: kunai install --force X.Y.Z
kunai rollback --list        # verified local versions only
kunai uninstall              # ownership-aware; use npm uninstall -g for npm channel
```

### Support matrix (0.3.0)

| Target                                      | Status                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| Linux glibc/musl x64 + arm64 (four targets) | Supported                                                      |
| macOS x64/arm64                             | Beta                                                           |
| Windows x64                                 | Beta                                                           |
| Windows ARM64                               | Experimental                                                   |
| WSL                                         | Linux environment (separate from Windows-native PATH/mpv/data) |
| BSD                                         | Unsupported binary                                             |

Alpine:

```bash
apk add mpv yt-dlp ffmpeg
curl -fsSL https://kunai.kitsunekode.in/install.sh | bash
kunai --version
kunai --setup
```

YouTube cookies (optional): `youtubeMetadata.cookiesFromBrowser` or absolute
`cookiesFile` — never paste cookie contents into issues; review redacted
`/export-diagnostics` bundles. No DRM bypass claim.

## Useful Commands

```bash
kunai
kunai -a
kunai -S "Dune"
kunai -i 438631 -t movie
kunai --debug
kunai --setup
kunai --offline
kunai doctor
kunai upgrade
```

Default download path (when downloads are enabled):

- Linux: `~/.local/share/kunai/downloads` (or `XDG_DATA_HOME/kunai/downloads`)
- macOS: `~/Library/Application Support/kunai/downloads`
- Windows: `%LOCALAPPDATA%\kunai\downloads`

Recommendation shortcuts:

```bash
# inside Kunai command palette
/recommendation
/downloads
/library
/up-next
```

Download workflow shortcuts:

- From browse results, use `Ctrl+D` / `/download` to queue the selected result.
- During playback or post-playback, use `d` / `/download` to queue the current stream.
- Use `/downloads` to inspect active/failed/completed jobs and retry or cancel entries.

Playback recovery shortcuts:

- Use `r` / `/recover` to refresh the current stream and resume.
- Use `/recompute` when provider/source inventory looks stale and cached provider memory should be bypassed.
- Use `⇧F` / `/fallback` to try the next compatible provider.
- Use `o` / `/source` for source and `k` for quality.

## Diagnostics

- Use `--debug` for verbose logs
- Use `--debug-json` to write scoped JSONL diagnostics traces
- Use `--debug-session` for a developer repro session with trace path and breakpoint guidance
- Use `/export-diagnostics` inside Kunai for a redacted report snapshot
- Use `/report-issue` to export a redacted bundle and open a prefilled GitHub issue draft
- Use `kunai doctor` when PATH or install ownership looks wrong

## Caveats

- Provider availability can drift over time
- Subtitle/source inventories vary by provider and title
- Kunai prioritizes deterministic recovery and diagnostics over opaque retries
- This npm channel needs Node (launcher) plus the platform optional dependency; native binaries do not

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or
distribute video content. Streams and related assets are served by non-affiliated
third-party providers. Use responsibly and in accordance with applicable laws and
service terms.

## Project

- Repository: https://github.com/kitsunekode/kunai
- Issues: https://github.com/kitsunekode/kunai/issues
