<div align="center">

<img src=".reference/design/brand/kunai-readme-hero.svg" alt="Kunai terminal media client" width="680" />

<h1>Kunai</h1>

**Watch anime, movies, TV series and YouTube from your terminal.**
Search, choose a source and play in mpv, with subtitles, resume and offline downloads.

[![CI](https://github.com/KitsuneKode/kunai/actions/workflows/ci.yml/badge.svg)](https://github.com/KitsuneKode/kunai/actions/workflows/ci.yml)
&nbsp;[![npm](https://img.shields.io/npm/v/@kitsunekode/kunai?color=ff8fb0&label=kunai&logo=npm)](https://www.npmjs.com/package/@kitsunekode/kunai)
&nbsp;![built with](https://img.shields.io/badge/built%20with-Bun-ff8fb0)
&nbsp;![player](https://img.shields.io/badge/player-mpv-4fd1c5)
&nbsp;[![license](https://img.shields.io/badge/license-MIT-968a98)](LICENSE)

**Linux / macOS**

```bash
curl -fsSL https://kunai.kitsunekode.in/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://kunai.kitsunekode.in/install.ps1 | iex
```

Then run:

```bash
kunai --setup && kunai -S "Dune"
```

Native binaries include their runtime. Install mpv for desktop playback.

[Installation guide](https://kunai.kitsunekode.in/docs/users/install-and-update) ·
[What you can do](https://kunai.kitsunekode.in/docs/users/what-you-can-do) ·
[Release notes](https://kunai.kitsunekode.in/releases)

![Kunai walkthrough: type a search, preview a title, choose an episode and recover playback](.reference/design/brand/demo-ui-walkthrough.gif)

[Watch the MP4 walkthrough](.reference/design/brand/demo-ui-walkthrough.mp4)

</div>

Kunai keeps search, title details, episodes and playback controls in one
keyboard-driven terminal session. The shell stays open while mpv plays, so you
can switch sources, manage Up Next or find your next video.

Kunai is in beta. This README describes the current source; check the
[release notes](https://kunai.kitsunekode.in/releases) for the published version.
Provider availability, subtitles and quality choices depend on the title,
upstream service and your network.

## Why Kunai

- **Find something to watch.** Search anime, movies, TV series and
  YouTube. Preview details before opening a result.
- **Recover when playback stalls.** Refresh the current stream, choose
  another source or try the next compatible provider without restarting.
- **Continue watching.** Resume from local history, arrange Up Next,
  save a Watchlist and organize Playlists.
- **Watch offline.** Queue supported media for offline use, then play
  downloaded media from Library.
- **Use the controls you prefer.** Navigate with the keyboard or supported
  mouse controls. Each screen shows its available shortcuts.

<a id="kunai-vs-ani-cli"></a>

For viewers looking for an **ani-cli alternative**, Kunai brings anime and
other video catalogs into a persistent terminal interface. It builds on tools
such as ani-cli, mpv and yt-dlp; playback remains in mpv.

## Quick Start

### Install Kunai

Use the native installer for a self-contained binary:

```bash
curl -fsSL https://kunai.kitsunekode.in/install.sh | bash
```

```powershell
irm https://kunai.kitsunekode.in/install.ps1 | iex
```

Or use npm with Node on your PATH:

```bash
npm install -g @kitsunekode/kunai
```

Native binaries need no separate Bun or Node installation. The npm and Bun
global-package channels use a Node launcher and need Node on your PATH.

<a id="dependencies-by-platform"></a>

### Install Playback Tools

| Tool                                                    | When you need it                                    |
| ------------------------------------------------------- | --------------------------------------------------- |
| [mpv](https://mpv.io/installation/)                     | Desktop playback                                    |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) | YouTube playback and offline downloads              |
| ffprobe, included with FFmpeg                           | Download validation where available                 |
| curl-impersonate                                        | Providers that require an impersonating HTTP client |

Install mpv with your package manager:

```bash
sudo pacman -S mpv                              # Arch Linux
sudo apt install mpv                            # Debian / Ubuntu
brew install mpv                                # macOS
winget install --id mpv-player.mpv-CI.MSVC -e     # Windows
```

See the [installation guide](https://kunai.kitsunekode.in/docs/users/install-and-update)
for optional tools and the [platform guide](https://kunai.kitsunekode.in/docs/users/platforms)
for support levels, Alpine, WSL and terminal images.

### Verify

```bash
kunai --version
mpv --version
kunai --setup
kunai -S "Dune"
```

### Search and Resume

```bash
kunai                       # open the shell
kunai -a -S "Demon Slayer"  # search anime
kunai -y -S "live coding"   # search YouTube
kunai --continue           # resume an unfinished title
```

These search commands open results; select a title before playback begins.

<a id="features"></a>

## Watching, Organized

| Workflow                | What Kunai provides                                                       |
| ----------------------- | ------------------------------------------------------------------------- |
| Search and previews     | Type-ahead suggestions, title details and mode-specific search history    |
| Sources and tracks      | Provider, source, quality, audio and subtitle choices where available     |
| Continue watching       | Local resume positions and episode navigation                             |
| Up Next                 | A recoverable playback order, separate from saved Playlists               |
| Watchlist and Playlists | Save titles for later and organize named collections                      |
| Downloads and Library   | Opt-in download jobs and local playback                                   |
| Discovery               | Recommendations and release-calendar views when catalog data is available |
| Autoskip                | Intro, recap and credits controls when supported timing data exists       |
| Personalization         | Themes, contextual tips and optional Discord Rich Presence                |

Read the [feature guide](https://kunai.kitsunekode.in/docs/users/what-you-can-do)
for supported workflows and limitations. Mobile terminal work is
[experimental](https://kunai.kitsunekode.in/docs/users/mobile-preview).

<a id="inside-the-shell"></a>

### Controls to Start With

```text
/       command palette
Tab     switch between series, anime and YouTube modes
o       open Tracks during playback
k       choose quality during playback
r       recover the current stream
Shift+F try the next compatible provider
Ctrl+C  quit
```

Movies and TV series share series mode. The footer shows the shortcuts for the
screen you are using. See [commands and shortcuts](https://kunai.kitsunekode.in/docs/users/commands-and-shortcuts)
for the full list.

## Local Data and Optional Integrations

History, Up Next, Playlists and download records are stored on your machine.
Kunai does not require a Kunai account. Optional AniList and TMDB integrations
send progress to the service you connect; Discord presence is opt-in.

Usage analytics requires explicit consent. It does not include titles,
queries, providers, stream URLs or file paths. See
[reliability and privacy](https://kunai.kitsunekode.in/docs/users/reliability-and-privacy).

<a id="docs"></a>

## Get Help and Keep Kunai Updated

- [Troubleshooting](https://kunai.kitsunekode.in/docs/users/troubleshooting): find a recovery step for your symptom.
- [Providers](https://kunai.kitsunekode.in/docs/users/providers): understand source capabilities and availability.
- [Downloads and offline](https://kunai.kitsunekode.in/docs/users/downloads-and-offline): manage jobs and local media.
- [Customization](https://kunai.kitsunekode.in/docs/users/customization): set language, quality and theme preferences.
- [Diagnostics](https://kunai.kitsunekode.in/docs/users/diagnostics-and-reporting): inspect and export a redacted report.

Run `kunai doctor` to check installation and tool discovery.
Keep it current with `kunai upgrade`, which follows your install channel.
`kunai uninstall` keeps your data unless you explicitly add `--purge`.

## Contribute

Provider fixes, platform testing, accessibility improvements and clear bug
reports help Kunai stay useful. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a change, or [report an issue](https://github.com/KitsuneKode/kunai/issues).

Kanna, Kunai's fox, appears during setup and in the shell. Read
[Kanna's guide](https://kunai.kitsunekode.in/docs/users/kanna) for her controls.

Built with Bun, TypeScript, React and Ink, with help from mpv, yt-dlp, ani-cli,
AniSkip and VLC. Kunai is [MIT licensed](LICENSE).

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or
distribute video content. Streams and related assets are served by non-affiliated
third-party providers. Use responsibly and in accordance with applicable laws and
service terms.
