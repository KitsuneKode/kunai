---
status: experimental
lastReviewed: "2026-08-31"
---

# Google Cast playback

> Agent-facing (L3). Direct Google Cast playback is experimental. The polished
> persistence, split-output controls, and public support promise remain later
> work.

## Current shape

`PlaybackRouter` keeps local mpv as the default and selects
`GoogleCastPlaybackBackend` only for an explicit `--cast` or
`--cast <device>` launch.
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
  -> google-cast target -> compatibility gate -> Cast V2 -> receiver
```

The receiver fetches the media URL directly. Kunai remains the controller; it
does not encode or retransmit direct-compatible media.

## Experimental launch surface

```sh
bun run dev -- --cast-list
bun run dev -- --cast -S "Dune"
bun run dev -- --cast "Living Room TV" -S "Dune"
bun run dev -- --cast 192.168.1.20 -S "Dune"
```

With no device argument, `--cast` opens Kunai's playback-device picker. It
offers local mpv, discovered receivers, refresh, and manual address entry.
Friendly names resolve through mDNS. A direct IPv4 address, `host.local`, or
`host.local:port` bypasses discovery for LANs that suppress multicast.
Explicit friendly names are validated before the shell opens; punctuation is
normalized so straight and curly apostrophes identify the same receiver.

## Compatibility boundary

Phase-2 direct playback accepts HTTP(S) HLS, DASH, MP4, WebM, and MP3 URLs with
no provider request headers. Local files, deferred media, or streams carrying
headers are classified as `gateway-required`; they are not handed to the
receiver and are not routed through `packages/relay`.

The Phase-3 local media gateway will own protected manifests and segments.
Kunai's provider relay remains metadata-only.

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
| disconnect     | quit after start; error before start |

Shutdown stops the active remote media session before releasing local mpv.

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
  test/unit/services/playback/cast-compatibility.test.ts \
  test/unit/services/playback/cast-target-selector.test.ts \
  test/unit/app/playback/choose-google-cast-target-shell.test.ts \
  test/unit/services/playback/playback-router.test.ts
```
