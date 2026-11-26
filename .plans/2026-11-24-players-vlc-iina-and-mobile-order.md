---
status: active
created: "2026-11-24"
lastReviewed: "2026-11-26"
---

# Plan: VLC and IINA beside mpv, and the mobile order

## Status

- **Status:** IN PROGRESS. Desktop VLC landed in the 0.4.0 train as an
  observed player (`--player vlc`, #764), with auto-skip and next episode in
  the same window (#776) and the player saved in Settings (#821). IINA and the
  mobile order below remain. The table under "Where we are" is the 2026-11-24
  starting point, kept for the record.
- **Owns:** desktop player choice (VLC, IINA) and the order of the mobile work.
  The mobile design itself stays in
  [mobile parity and phone web](./2026-10-11-mobile-parity-and-phone-web.md);
  the road-to-9.5 follow-up "Player choice: VLC and IINA beside mpv" points here.

## Where we are (main, 2026-11-24)

The seams this needs already exist; nothing below is a rewrite.

| Piece                     | State                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PlayerService`           | One interface; `PersistentMpvSession`/`launchMpv` (managed) and `HandoffPlayerService` (Android intents) implement it                                                                                              |
| `PlayerCapabilities`      | `observation`, `customHeaders`, `externalSubtitles`, `localFiles`, `progressEvents`, `completion`, `autoSkip`, `trackControl` — already read by the command dispatchers, launch, history persistence and key hints |
| `--player auto\|mpv\|vlc` | Parsed everywhere; `resolvePlayerMode` returns `unsupported` for VLC on desktop                                                                                                                                    |
| Stream gateway (#629)     | Loopback-only, per-playback token, upstream allowlist, header injection, HLS/DASH rewriting. Written for Android intents; nothing in it is Android-specific                                                        |
| Output readiness (#755)   | `playback-output-gate.ts` decides "playing" from backend-neutral samples (`videoOutParams`/`voConfigured`, selected video track)                                                                                   |
| Android VLC / mpv-android | Intent handoff through the gateway (#287, #629); detached (no progress, no completion); fixes open in #718, #674, #677                                                                                             |

## Principles

1. **One capability model, every backend.** A player declares what it can do;
   every feature reads the declaration. A VLC session that cannot auto-skip
   says so in the key hints, it does not pretend (hazard: the silent no-op).
2. **Reuse the gateway, never widen it.** Players that cannot send headers get
   the loopback gateway — the same threat model as Android: 127.0.0.1, token
   paths, allowlist. No LAN bind, no media relay (relay stays metadata-only).
3. **Same evidence, same rules.** A backend maps its own status into
   `PlayerStatsSample`, so the watchdog, the output gate (#755), resume and
   history all run unchanged. No second state machine.
4. **No secrets in argv.** VLC's control-interface password must not appear in
   the process list (road-to-9.5 security target).
5. **Measure before building.** Exactly what #755 did with mpv: run the real
   player on each OS, record what it reports, then write code against that.

## Players

### P0 — VLC spike (1 day, start today)

Install VLC 3.0.x on Linux, macOS and Windows and record, in a new
`.docs/player-dossiers/vlc.md`:

- **Control interface.** `--extraintf=http --http-host=127.0.0.1
  --http-port=<ephemeral>`; `GET /requests/status.json` fields: `time`,
  `length`, `position`, `state`, and `stats.decodedvideo` /
  `stats.displayedpictures` (decode evidence for the output gate). Confirm the
  `stats` block is present by default on each OS.
- **Commands.** `pl_pause`, `seek&val=`, `pl_stop`, `addsubtitle&val=`,
  `in_play&input=` (next episode in the same window), volume.
- **Password without argv.** VLC's HTTP interface requires a password. Test
  passing it through a temporary `--config` file that is a copy of the user's
  own `vlcrc` plus `http-password=…` (mode 0600, deleted on exit), so VLC fans
  keep their settings and nothing secret is in argv. Fallback to test:
  `oldrc` over a Unix socket on Linux/macOS (permission-protected like mpv IPC).
- **Request shape.** `:http-referrer=` and `:http-user-agent=` input options;
  confirm Origin/cookies are impossible (so those streams use the gateway).
- **Launch options.** `--start-time`, `--meta-title`, `--sub-file`,
  `--play-and-exit`, `--no-video-title-show`; how a missing codec looks in
  `stats` (audio decodes, `decodedvideo` stays 0) — the #755 failure case.
- **Discovery.** PATH, `/Applications/VLC.app/Contents/MacOS/VLC`,
  `%ProgramFiles%\VideoLAN\VLC\vlc.exe`, Flatpak `org.videolan.VLC`, Snap.

**Done when** the dossier has a per-OS table like #755's mpv table, and the
password route is chosen. If `stats` is missing on an OS, VLC there runs with
`unverified` readiness (the gate's existing fallback), documented.

### P1 — Capability audit (S, after P0)

Walk every mpv-only feature and make sure it reads a capability rather than
assuming mpv: in-process reconnect, output readiness, persistent session /
autoplay chain, autoskip, track control, chapter markers, HDR route, the mpv
bridge script, `Ctrl+Shift+S` share. Add the capabilities P2/P3 need
(`sameWindowNextEpisode`, `inProcessReconnect`, `decodeEvidence`) and a test
that fails when a declared capability has no reader.

### P2 — IINA on macOS (S)

IINA is mpv inside: `iina-cli --mpv-input-ipc-server=<socket>` exposes the same
IPC Kunai already speaks. It becomes the managed-mpv path with a different
binary and window. `--player iina`, `auto` prefers mpv, then IINA on macOS.
Verify the bridge script loads (`--mpv-script=`); if it does not, IINA runs
without the in-player menu and says so.

### P3 — VLC desktop, observed (M)

`VlcPlayerService` implements `PlayerService` with capabilities from P0:

| Capability          | VLC                                                                           |
| ------------------- | ----------------------------------------------------------------------------- |
| `observation`       | `managed` (HTTP status polled ~1 s, mapped to `PlayerStatsSample`)            |
| `customHeaders`     | Referer/UA direct; anything more through the loopback gateway                 |
| `externalSubtitles` | `--sub-file` / `addsubtitle`                                                  |
| `localFiles`        | yes (downloads play offline)                                                  |
| `progressEvents`    | yes — resume, history, Continue Watching, trackers                            |
| `completion`        | yes — `state` + position near `length`                                        |
| `decodeEvidence`    | `stats.decodedvideo > 0` → the #755 gate; `unverified` where stats are absent |
| `autoSkip`          | P4                                                                            |
| `trackControl`      | partial (audio/subtitle track picks); P4                                      |

- `--player vlc`, a `player` config key with a Settings row (Playback), shell
  completion, and `kunai doctor` reporting which players were found.
- `resolvePlayerMode` gains `managed-vlc`; `unsupported` is left for platforms
  where P0 failed.
- Each episode is one VLC launch first (simplest, honest); P4 adds same-window
  next episode.
- Tests: a fake VLC HTTP server (status JSON fixtures recorded in P0) for unit
  and integration; a native test that runs real VLC where CI has it, same shape
  as `video-decode-readiness-native.test.ts`.

### P4 — VLC parity extras (S each)

Auto-skip intro/credits via `seek`; next episode in the same window via
`in_play`; audio/subtitle picks from Tracks; startup failover through the
existing recovery (it already reads `PlaybackResult`).

## Mobile — the order

The design is settled in the mobile parity plan; this is the sequence.

1. **Land the open fixes, one class each.** #718 (gateway hardening, DNS
   fallback, doctor) is mergeable; rebase #674 (bounded handoffs, now
   conflicting); split #677 (≈6k lines mixing desktop audio, Android offline
   handoff and a local companion) into one PR per concern; land #672's route
   doc once it matches the tree.
2. **#631 — a real phone.** Maintainer step: Termux from F-Droid, install,
   search → play through VLC for Android and mpv-android, with a provider that
   needs headers (gateway) and one that does not. Nothing is called supported
   before this checklist passes.
3. **Touch in the terminal.** Termux turns taps into mouse events, so mouse
   coverage (#552) is phone usability today, before any web UI.
4. **`kunai serve`** (M3): the touch web UI served from the phone itself.
5. **APK spike** (one day, after 4): can an APK run the Bun binary — exec from
   `nativeLibraryDir`, DNS and CA certificates outside Termux, 16 KB pages,
   RAM. Providers are never ported to Kotlin. 32-bit Android TV stays
   unsupported (no 32-bit Bun).

**Where VLC meets mobile.** Android already hands streams to VLC for Android
through the same gateway P3 uses on desktop. Detached Android handoff cannot
report progress (`termux-am` gets no activity result); the honest model stays
"handed to VLC — confirm position or mark watched" until `kunai serve` or an
APK can receive VLC's result intent (`extra_position`, `extra_duration`).

## Seams this touches

- **Entry points:** `--player`, the Settings row, shell completion, `doctor`,
  post-play copy ("Played in VLC"), key hints per capability.
- **Every platform:** discovery and the password route differ per OS; P0 is
  per-OS on purpose.
- **Both lanes / every provider:** player-agnostic, but streams needing
  headers or cookies route through the gateway; yt-dlp-only streams stay
  mpv-only (VLC cannot run yt-dlp) and say so.
- **Docs:** `docs/users/` player page and the `--player` table, generated
  where the flag table is generated.

## Out of scope

LAN casting and remote control (a different threat model); Chromecast (#306);
VLC 4 nightlies until it ships stable.
