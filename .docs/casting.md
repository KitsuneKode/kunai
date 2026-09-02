---
status: experimental
lastReviewed: "2026-08-31"
---

# Google Cast playback

> Agent-facing (L3). Direct Google Cast playback is experimental. The polished
> persistence and a public support promise remain later work. Split audio is an
> explicitly experimental receiver mode.

## Current shape

`PlaybackRouter` keeps local mpv as the default and selects
`GoogleCastPlaybackBackend` only for an explicit `--cast` or
`--cast <device>` launch. Full video+audio Cast continues to use Google's
Default Media Receiver. Experimental audio-only Cast uses Kunai's registered
Custom Web Receiver and requires `KUNAI_CAST_RECEIVER_APP_ID`.
The Cast backend discovers `_googlecast._tcp.local` receivers through its own
small mDNS adapter. The picker and `--cast-list` also use DIAL/SSDP and, when
installed on Linux, the system Avahi resolver as bounded fallbacks on LANs that
suppress application-level multicast. Kunai connects to Cast V2 over TLS on
port 8009 and launches Google's
Default Media Receiver, and translates receiver status back into Kunai's
generation-stamped playback events.

```text
resolved StreamInfo -> PlaybackRouter
  -> local target       -> LocalPlaybackBackend -> PlayerService -> mpv
  -> google-cast target -> compatibility gate
       -> direct URL -> Cast V2 -> receiver
       -> protected URL -> session media gateway -> receiver
  -> split-audio target -> local mpv + experimental Kunai Custom Receiver audio
```

The receiver fetches direct-compatible URLs itself. Header-protected streams
use a session-scoped gateway on the laptop; Kunai forwards source bytes without
rendering, transcoding, or screen capture.

## Experimental launch surface

```sh
bun run dev -- --cast-list
bun run dev -- --cast -S "Dune"
bun run dev -- --cast "Living Room TV" -S "Dune"
bun run dev -- --cast 192.168.1.20 -S "Dune"
bun run dev -- --cast-audio "Living Room TV" -S "Dune"
```

With no device argument, `--cast` opens Kunai's playback-device picker. It
offers local mpv, full A/V Cast, experimental remote-audio/local-video output,
refresh, and manual address entry.
`--cast-audio [device]` selects that experimental split-output route directly;
without a device it opens an audio-only receiver picker. A normal `--cast`
picker only advertises the experimental audio-only choice when
`KUNAI_CAST_RECEIVER_APP_ID` is configured.
Friendly names resolve through mDNS. A direct IPv4 address, `host.local`, or
`host.local:port` bypasses discovery for LANs that suppress multicast.
Explicit friendly names are validated before the shell opens; punctuation is
normalized so straight and curly apostrophes identify the same receiver.

### Experimental audio-only receiver setup

The web receiver is served by the docs application at `/cast-receiver`. Host
that route over HTTPS, register its public URL as a Custom Web Receiver in the
Google Cast SDK Developer Console, then expose the assigned application ID to
Kunai as `KUNAI_CAST_RECEIVER_APP_ID`. This ID is read only by
`--cast-audio` and by the optional experimental audio choice in the bare
`--cast` picker. Full video+audio `--cast` never requires or launches it.

The hosted page contains only the Cast receiver shell and clock protocol. Media
continues to travel directly from its provider or through Kunai's tokenized,
session-scoped LAN gateway; the public receiver host is not a shared media
relay.

## Compatibility boundary

Direct playback accepts HTTP(S) HLS, DASH, MP4, WebM, and MP3 URLs with no
provider request headers. Streams with provider headers use the local media
gateway. The gateway forwards provider headers and byte ranges and rewrites HLS
playlist resources (variants, segments, encryption keys, and maps) plus basic
DASH URL fields into tokenized local routes. Local files and deferred media are
still rejected rather than silently routed incorrectly.

The gateway binds only to the receiver-facing LAN address, uses a fresh 256-bit
path token per playback, accepts only GET/HEAD/OPTIONS, and resolves opaque
in-memory resource IDs. Clients cannot place arbitrary upstream URLs in a
request. The server and all resource mappings are destroyed when playback
ends, is stopped, or fails to connect/load. Error bodies never echo upstream
URLs or provider credentials. Kunai's `packages/relay` remains metadata-only.

## Lifecycle

The router owns generation identity across local and remote backends. Backend
generation values are remapped before app policy sees them, preventing a late
receiver or mpv event from reviving a replacement playback cycle.

Google Cast status maps as follows:

| Receiver state | Kunai event/result |
| -------------- | ------------------ |
| `BUFFERING`    | network buffering  |
| first `PLAYING` | playback started  |
| later `PLAYING` after pause | playback resumed |
| `PAUSED`       | playback paused    |
| `IDLE/FINISHED` | EOF               |
| `IDLE/ERROR`   | playback error     |
| transitional `IDLE` without a reason | ignored |
| status for a replaced media-session ID | ignored |
| disconnect     | quit after start; error before start |

Shutdown stops the active remote media session and closes its gateway before
releasing local mpv.

## Controls and split audio

While playback is active, `Space` pauses or resumes, `Left` and `Right` seek 10
seconds, and clicking the progress track seeks directly to that point. These
controls share one contract across local mpv, full Cast, and split output.

Split output uses `ffmpeg` to remove video and progressively encode MP3 audio as
a live Cast stream.
The same random LAN-token boundary used by Cast media delivery keeps the
extracted audio private to that playback. The receiver can start fetching audio
immediately instead of waiting for the complete episode to be transcoded. Local
mpv is the authoritative timeline. Kunai opens it with local audio disabled,
sets an explicit paused state, starts remote audio at the same source position,
then releases video when the receiver reports playback. A relative or absolute
seek pauses local video, seeks mpv, replaces the live audio route with a fresh
`ffmpeg` stream at that timestamp, and resumes when the receiver is ready. The
replacement session is stopped through its abort lifecycle exactly once; once
it reports playback, Kunai advances the paused video by the receiver's measured
startup time before resuming. While playing, receiver progress is the clock
authority: Kunai corrects local video when drift reaches 250 ms, while ignoring
smaller status jitter.
Pausing explicitly stops the live remote stream; resuming rebuilds it from mpv's
current position, because live MP3 receivers do not reliably implement media
pause. Audio extraction uses ffmpeg's fast input seek so a large resume offset
does not leave the receiver waiting for its first MP3 byte. Once Cast reports
playback, Kunai aligns local video to the receiver's measured position.
Stopping terminates `ffmpeg` and closes the LAN route. Split output requires
`ffmpeg`; receiver buffering and wireless conditions can still make
synchronization perceptible.

Full A/V Cast exposes the selected subtitle and discovered subtitle inventory as
WebVTT text tracks. A separate session-tokenized LAN route fetches provider subtitle
files on demand and converts SRT or basic ASS cues to WebVTT for the receiver. The
subtitle route is destroyed with the playback session and does not expose arbitrary
upstream URLs.

## Testing

Protocol tests use deterministic byte fixtures and fake sessions—never LAN
hardware or sleeps. Hardware validation must cover discovery and direct-IP
selection separately because multicast behavior varies by router and platform.

Run the focused suite with:

```sh
bun run --cwd apps/cli test:file \
  test/unit/services/playback/google-cast-envelope.test.ts \
  test/unit/services/playback/google-cast-discovery.test.ts \
  test/unit/services/playback/google-cast-dial-discovery.test.ts \
  test/unit/services/playback/google-cast-native-discovery.test.ts \
  test/unit/services/playback/google-cast-playback-backend.test.ts \
  test/unit/services/playback/audio-extraction-gateway.test.ts \
  test/unit/services/playback/cast-subtitle-gateway.test.ts \
  test/unit/services/playback/split-audio-playback-backend.test.ts \
  test/unit/services/playback/session-media-gateway.test.ts \
  test/unit/services/playback/cast-compatibility.test.ts \
  test/unit/services/playback/cast-target-selector.test.ts \
  test/unit/app/playback/choose-google-cast-target-shell.test.ts \
  test/unit/services/playback/playback-router.test.ts
```
