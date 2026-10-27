# Kunai

**Watch anime, movies, TV series and YouTube from your terminal with mpv.**

Search for a title, choose a source and keep watching in one keyboard-driven
session, with source switching, subtitles, resume and offline downloads.

[Installation guide](https://kunai.kitsunekode.in/docs/users/install-and-update) ·
[Feature guide](https://kunai.kitsunekode.in/docs/users/what-you-can-do) ·
[Release notes](https://kunai.kitsunekode.in/releases) ·
[GitHub repository](https://github.com/KitsuneKode/kunai)

## Install and Start

```sh
npm install -g @kitsunekode/kunai
kunai --setup
kunai
```

The npm package contains a Node launcher and selects the matching native
platform package. **Keep Node on your PATH.** Bun's global-package channel
uses the same launcher and also needs Node.

For a self-contained binary with no separate Node or Bun installation, use the
[native installation guide](https://kunai.kitsunekode.in/docs/users/install-and-update).

## Playback Tools

- **mpv:** required for desktop playback.
- **yt-dlp:** required for YouTube playback and offline downloads.
- **ffprobe:** used for download validation where available.
- **curl-impersonate:** used by providers that need an impersonating HTTP client.

```sh
sudo pacman -S mpv yt-dlp     # Arch Linux
sudo apt install mpv yt-dlp   # Debian / Ubuntu
brew install mpv yt-dlp      # macOS
```

On Windows, install mpv with `winget install --id mpv-player.mpv-CI.MSVC -e`.
For yt-dlp, use `winget install --id yt-dlp.yt-dlp -e`.
See the [platform guide](https://kunai.kitsunekode.in/docs/users/platforms)
for support levels and optional tool setup.

## Find Something to Watch

```sh
kunai -S "Dune"              # movies and TV series
kunai -a -S "Demon Slayer"   # anime
kunai -y -S "live coding"    # YouTube
kunai --continue            # resume an unfinished title
kunai --offline             # open local media
```

The shell stays open while mpv plays. Use the footer shortcuts or `/` for
the command palette:

| Task                             | Command or key           |
| -------------------------------- | ------------------------ |
| Choose a provider                | `/provider`              |
| Open source and track choices    | `o` during playback      |
| Choose quality                   | `k` during playback      |
| Recover the current stream       | `r` or `/recover`        |
| Try the next compatible provider | `Shift+F` or `/fallback` |
| Arrange playback order           | `/up-next`               |
| Save titles for later            | `/watchlist`             |
| Manage offline downloads         | `/downloads`             |
| Play downloaded files            | `/library`               |

Source, quality, audio and subtitle choices depend on the provider and title.
Recovery can try another source; it cannot guarantee that a title is available.
Read the [commands guide](https://kunai.kitsunekode.in/docs/users/commands-and-shortcuts)
for the full controls.

## Local Data and Privacy

History, Up Next, Playlists and download records are stored locally. A Kunai
account is not required. AniList and TMDB sync and Discord presence are
optional integrations. Usage analytics requires explicit consent and excludes
titles, queries, providers, stream URLs and file paths.

Read [reliability and privacy](https://kunai.kitsunekode.in/docs/users/reliability-and-privacy)
for the data and network boundaries.

## Update, Diagnose and Remove

```sh
kunai upgrade --check
kunai upgrade
kunai doctor
npm uninstall -g @kitsunekode/kunai
```

`kunai doctor` checks tool discovery and install ownership. For playback
problems, open `/diagnostics` or `/export-diagnostics` in the shell. Review an
export before attaching it to an issue, and never paste cookies or credentials.

See [troubleshooting](https://kunai.kitsunekode.in/docs/users/troubleshooting)
for recovery steps and [installation and removal](https://kunai.kitsunekode.in/docs/users/install-and-update#uninstall)
for data-retention options.

## Project

Kunai is a beta terminal media client built with Bun, TypeScript, React and Ink.
Provider availability varies with upstream services and your network. Experimental
mobile work is documented separately and is not a supported full mobile app.

- [Report an issue](https://github.com/KitsuneKode/kunai/issues)
- [Contribute to Kunai](https://github.com/KitsuneKode/kunai/blob/main/CONTRIBUTING.md)
- [Read the MIT license](https://github.com/KitsuneKode/kunai/blob/main/LICENSE)

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or
distribute video content. Streams and related assets are served by non-affiliated
third-party providers. Use responsibly and in accordance with applicable laws and
service terms.
