---
status: archived
archived: "2026-10-28"
---

# Mobile M1/M2 implementation record

Historical record extracted from the mobile parity plan after the M1/M2 core
landed on main. These sections record implementation history, not physical
qualification or publication. Current behavior belongs to
[the architecture](../../.docs/architecture.md) and
[the mobile runtime guide](../../.docs/mobile-terminal-runtime.md).
Unfinished qualification, distribution and phone-web work remains in
[the active plan](../../.plans/2026-10-11-mobile-parity-and-phone-web.md).

## M1 — Termux runs the real CLI (implemented; device qualification pending)

The #287 functionality is present on current `main`:
Bionic `android-arm64`/`android-x64` targets in build, release, checksums,
npm optional packages, `install.sh` Termux detection (`$TERMUX_VERSION` /
Termux `$PREFIX`), upgrade asset selection, `--player auto|mpv|vlc`,
detached-handoff result modelling (no invented progress/EOF/completion),
managed-only controls disabled with an explanation.

## M2 — Android stream gateway

The gateway implementation is present on merged main. The continuation on 2026-10-12 reproduced and
fixed idle shutdown during progressive responses, chooser subtitle loss,
blocked playlist/MPD targets escaping to the external player, and a first-chunk
playlist size-limit bypass. Upstream DASH now resolves relative hierarchical
BaseURLs and inherited SegmentBase/List/Template references against the final
manifest URL. Segment substitutions use guarded session routes; unsupported
XML/DRM/external-resource forms are refused with a sanitized 422. Generated
deferred MPDs share the same rewriter. The architecture doc owns the supported
forms and bounds.

The implemented handoff gateway is used when the player cannot
take headers (Android intents; any future launch-only player):

- Bind `127.0.0.1` on an ephemeral port; every route is under an unguessable
  per-playback token path (`/g/<128-bit token>/...`); requests without it 404.
- Upstream allowlist = the probed candidate's origin plus hosts that appear in
  the playlists it serves (HLS master → media → segment/key URIs are rewritten
  to gateway paths). Reuse `assertRelayUpstreamUrl`-style validation and the
  existing DNS/private-address guards; never follow a redirect to a private
  address.
- Inject exactly the candidate's normalized headers
  (`normalizeStreamHttpHeaders`); cookies only if the candidate carries them.
- Stream bodies (no whole-segment buffering for MP4/large files); support
  `Range` for progressive MP4 so seeking works.
- External subtitles: serve the selected track through the gateway and pass it
  as the player's subtitle extra (`subtitles_location` for VLC, `subs` for
  mpv-android).
- Lifetime: starts with the handoff, stops on idle timeout (no traffic for N
  minutes) or when the shell exits; one gateway per process.
- Lift #287's rejection list (headers, cookies, external subtitles, deferred
  locators) for streams the gateway can serve; keep rejecting only what it
  genuinely cannot (DRM, yt-dlp-only URLs without a local yt-dlp).

Edge cases: HLS with AES keys (rewrite `#EXT-X-KEY` URIs), relative URIs,
byte-range playlists, servers that 403 on missing Origin, players that open
several connections at once, Termux being backgrounded (doc `termux-wake-lock`).

