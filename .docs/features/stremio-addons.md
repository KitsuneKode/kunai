---
status: current
lastReviewed: "2026-11-24"
---

# Stremio addons

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Stremio addons are experimental and off by default. Kunai ships none. Enable them in Settings → Sources → Experimental: Stremio addons or run kunai addons enable.

> Stremio addons are third-party servers you choose. Kunai checks each addon stream, but mpv opens its own connection. A hostile addon server could answer mpv differently and reach a device on your network. Older FFmpeg versions may follow redirects. Downloads and Android handoff do not use addons.

Only install addons you trust.

A user can add Stremio addons as movie and series sources. An addon exists only
because the user gave its manifest URL, and addon providers stay inert until
both `experimentalStremioAddons` and a stored risk acknowledgement are set —
`stremioAddonsEnabled` in `apps/cli/src/domain/provider/stremio-addons.ts` is
the single gate, re-read from the config file each time so a standalone
`kunai addons disable` stops a running session at the next resolve. Each
installed addon is one provider in the movies and series lane, ordered and
switched off like any bundled provider.

## What an addon may do

An addon is an HTTPS server that answers two JSON requests. Nothing it sends is
executed, and every field Kunai reads is schema-checked first
(`packages/providers/src/stremio-addon/protocol.ts`).

| Rule                    | Where it is enforced                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| HTTPS, public host only | `parseStremioAddonUrl` on entry and on every load; redirects re-checked in `client.ts` |
| Bounded responses       | `STREMIO_ADDON_LIMITS`: manifest 512 KiB, stream list 2 MiB, 200 streams read          |
| Bounded time            | `STREMIO_ADDON_TIMEOUTS`, inside the shared per-attempt budget                         |
| Direct links only       | `classifyAddonStreams` keeps public http(s) URLs and counts everything else by reason  |
| Probed before success   | `verifyCandidateStream`, with the stream's own request headers                         |
| Never relayed           | the manifest declares `relaySafe: false` and has no relay profile                      |

Torrents (`infoHash`), YouTube ids, external pages, non-http schemes and
private-address URLs are not playable. They are counted in a `source:skipped`
trace event and named in the failure message, never dropped without a trace.

## What an addon stream may be (experimental)

In this experimental release, an addon stream is playable only when it is one self-contained
direct media file: MP4-family (`ftyp`) or Matroska/WebM (`EBML`). HLS, DASH
and every other playlist form are refused — a `.m3u8`/`.mpd` URL before any
request is made, and playlist-shaped bodies (extensionless included) after one
bounded read. Redirects are never followed: a redirecting answer is a refusal.

The check is `requireDirectMedia` in `stream-reachability.ts`: one guarded GET
asking for `bytes=0-4095` with the stream's own request headers and the normal
DNS pinning, then positive identification of the file signature. It runs at
the resolve gate (only verified files enter the inventory), again immediately
before the first mpv spawn, before every persistent-session `loadfile`, and
before an in-process reconnect reload. A fresh resolve attestation never skips
the strict preflight, because the attestation covers the probed URL at resolve
time, not this moment's answer. Supplied `Range`/`If-Range` request headers
refuse the candidate rather than being overridden. A partial response must
provide a valid Content-Range starting at byte zero, match the bytes actually
received, and agree with Content-Length when supplied. An EBML header must
carry a WebM or Matroska DocType; a complete MP4-family response must contain
a recognized top-level box after ftyp and no truncated boxes.

On top of the check, addon files — and only addon files — are handed to mpv
inside a file-local block: `--stream-lavf-o=max_redirects=0`,
`--load-unsafe-playlists=no`, `--tls-verify=yes`, and `ytdl=no` per file
(including the first file in a persistent session; one-shot launches disable
it for the process). `max_redirects` exists in
FFmpeg's HTTP protocol in 8.1+ and the 7.1.4 backport (not 8.0 or 7.1
initial); `stream-lavf-o` is the option mpv's top-level HTTP stream reads.
These are best-effort confinement on known-good builds, not a sandbox.

The initial persistent file's request headers are file-local, like each IPC
replacement. mpv restores its baseline when the file ends. Addon streams are
desktop-mpv-only in this experimental release: Android handoff refuses before launching a
player or opening a gateway. Offline downloads refuse addon provenance,
including a fallback, and ignore cached URLs with no recorded producer.

Residuals: the probe's request pins the checked address, but mpv resolves the
original hostname again for its own connection. On supported builds there is
no portable per-request way to pass the vetted address to mpv while keeping
the original HTTP Host, TLS SNI and certificate checks. An mpv built against
an FFmpeg without `max_redirects` can still follow a redirect at the lavf
layer; the media response can also change between probe and playback. A
user-configured proxy environment or third-party mpv scripts are outside
Kunai's control. Kunai installs no proxy and no media relay for addons, and a
passing preflight confirms the file answers — it is not end-to-end proof that
mpv can decode and play it.

## Subtitles an addon offers

mpv only ever sees local subtitle files for addon playback — at startup argv,
persistent inventory replacement and reconnect, late selection, and `sub-add`
alike. Every remote addon subtitle URL goes through the same guarded download
(`fetchStremioSubtitle`): public DNS pinning re-checked per redirect hop, a
3 s deadline, a 512 KiB body cap, and no addon credentials or headers sent to
the subtitle host. The body itself must prove a plain format — WebVTT, SRT, or
ASS — and the file extension comes from the verified body, never the URL; an
HTML page, playlist, binary, or unrecognized body is dropped and the track
skipped. Accepted bodies are written owner-only (`0600`) under a private temp
dir with numeric names, at most 64 distinct URLs per scope; the scope is
closed and its files deleted when the playback retires. A refused subtitle is
skipped, never substituted with its raw URL.

## Identity

Addons are asked by IMDb id: `tt…` for a movie, `tt…:season:episode` for an
episode. The id comes from the title when it carries one, else from TMDB's
`external_ids` record for the title's TMDB id (`resolveImdbIdFromTmdb`). It is
never matched by title text. A title with no IMDb id exhausts the addon with
`unsupported-title`; a catalog that could not be asked is a retryable
`network-error` and is not cached.

Season and episode numbers are sent as Kunai has them, which is TMDB's
numbering. Addons number episodes the way IMDb does. The two agree for most
series; where they differ (specials, split seasons) an addon can answer for a
different episode or with nothing. No remapping is attempted.

Anime mode does not use addons. Kunai's anime lane is keyed on AniList ids and
Stremio anime addons are keyed on Kitsu ids, with no exact map between them
here.

## The manifest URL is a secret

A configured addon often carries the user's settings, and sometimes an account
token, in the URL path. So:

- The provider id is `stremio-<host>-<8 hex of sha256(url)>`: stable, and free
  of the path.
- Only the host is shown, logged, traced or put in an error. Client errors name
  the addon by host and strip any URL from transport messages.
- `kunai addons list` and its JSON never print the URL. `add --stdin` keeps
  it out of argv and shell history; prefer it for token-bearing URLs.
- The URL is stored in `config.json` as `stremioAddons[].url`. It is not in the
  credential vault.

Configured URLs (with a path before manifest.json) may contain secrets in
forms a scrubber cannot recognize. Kunai shows `addon @ host` for those
installs and withholds arbitrary addon-supplied display text, including
cached names and versions. Unconfigured addons may show sanitized names. The
scrubber removes path and query parts, including compound and decoded values,
and absolute URLs from addon text before interpretation.

## Lifecycle

| Action                    | Takes effect                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Enable                    | Next resolve for already-loaded addons; sessions started while off never loaded them — restart |
| Disable                   | Next resolve, including in a running session; installed addons and the acknowledgement persist |
| Add                       | Next start: the provider list is built once per run; a restart loads newly installed addons    |
| Remove in the app         | Next resolve: each module re-reads the stored list (`isInstalled`)                             |
| Remove via `kunai addons` | After restart for sessions that were already running                                           |
| Reorder or switch         | Immediately, through `providerPriority` and `disabledProviders`                                |

A new addon is appended after the bundled providers, so it is a fallback until
the user moves it. Removing one also removes its id from the default provider,
the fallback order, the switches and per-title choices
(`removeStremioAddonFromConfig`).

Startup contacts no addon. The manifest is fetched on the first resolve and
cached for 12 hours; the mapped IMDb id is cached for 30 days. The stream list
is requested on every resolve. Recording a manifest display name only updates
that entry in the current stored list; an entry another process removed is
never re-added.

## Entry points

- `kunai addons enable | disable | list | add <url> | add --stdin | remove <n> | check [n]`
  (`apps/cli/src/services/providers/run-addons-command.ts`). `enable` requires
  the risk acknowledgement — interactive confirmation, or `--accept-risk` when
  stdin is not a terminal — and writes the flag plus timestamp together;
  `disable` patches only the flag. While off, `add` refuses before reading
  stdin or contacting the addon, and `list`/`check` report the disabled status
  without touching the network. `add` reads the
  manifest first and refuses an address that is not an addon, needs
  configuring, or cannot serve movie or series streams by IMDb id. With
  `--stdin` the URL is read from standard input instead of argv, so a
  token-bearing URL never reaches `ps` or shell history; the input is capped
  and never echoed. The command rejects unsupported flags, including
  `--dry-run`, before touching configuration. Manifest prefixes that match
  only some IMDb IDs are accepted; the provider still checks each title
  against the manifest.
- Settings → Sources → Stremio addons, and the Experimental: Stremio addons
  submenu beside it (`apps/cli/src/app-shell/settings/registry/addons.ts`).
  Adding here does not contact the addon; an unconfigured addon's name is
  recorded on first use.

## Code

| Piece                                 | Path                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| Protocol schemas and limits           | `packages/providers/src/stremio-addon/protocol.ts`         |
| URL rules, provider id, request paths | `packages/providers/src/stremio-addon/addon-url.ts`        |
| Guarded HTTP client                   | `packages/providers/src/stremio-addon/client.ts`           |
| Stream classification                 | `packages/providers/src/stremio-addon/streams.ts`          |
| Provider module                       | `packages/providers/src/stremio-addon/module.ts`           |
| Stored list helpers                   | `apps/cli/src/domain/provider/stremio-addons.ts`           |
| Module factory, IMDb lookup           | `apps/cli/src/services/providers/stremio-addon-modules.ts` |
| Registration                          | `apps/cli/src/container/bootstrap-providers.ts`            |

## Downloads

Downloads refuse addon streams: `DownloadService` rejects an addon provider id at enqueue (`DownloadEnqueueRejectedError` code `addon-source`) and again after resolve, so a fallback that lands on an addon is refused too. yt-dlp would fetch the URL with none of the playback confinement (direct-media check, pinned DNS, no redirects); lift this only when downloads share that guarded fetch.
