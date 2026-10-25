---
status: active
created: "2026-10-11"
---

# Mobile parity and the phone web surface

Goal: a phone user gets the same catalog, providers, history, Up Next and
downloads as a desktop user, without learning a terminal UI on a touch
keyboard. Android first (Termux); iOS stays on the `apps/mobile` a-Shell
preview until Android is qualified.

## Why this shape

- Bun ships official Android (Bionic) builds since 1.3.14 and
  `bun build --compile --target=bun-linux-{arm64,x64}-android`. The repo is on
  Bun 1.4.x, so the **real desktop CLI** runs in Termux — no second
  implementation, no feature drift. `apps/mobile` (Node/a-Shell host proof,
  no catalog or providers) is not the parity path; it stays the iOS preview.
- Android players (VLC, mpv-android) are launched by intent and cannot receive
  request headers or cookies. Most provider streams need a Referer/Origin, so
  a plain intent handoff covers only a minority of providers. Kunai already
  ships a loopback HLS relay for mpv (`apps/cli/src/infra/player/hls-relay.ts`);
  generalizing that pattern on-device closes the gap.
- A touch UI served from the phone itself (`http://127.0.0.1:<port>`) makes
  Kunai usable for people who will never drive a TUI on a phone keyboard. The
  phone does the work; nothing leaves the device except the provider requests
  the CLI already makes. This is the local-only half of the "paired web"
  direction in `kunai-experience-and-growth-moat.md`.

## Non-negotiables this plan must keep

- The shared relay stays metadata-only. The stream gateway below is a
  **per-process loopback** server on the device that runs the player — the
  same category as `hls-relay.ts`, never a hosted or LAN-exposed media route.
- Every handed-off stream is still the candidate `verifyCandidateStream`
  probed; the gateway forwards exactly that request shape.
- No new analytics, no install id, no shared URLs baked into binaries.
- One desktop entrypoint: `kunai serve` is a subcommand of
  `apps/cli/src/main.ts`, not a new binary.
- Concurrent TUI + `serve` on one profile follows ADR 0003.

## M1 — Termux runs the real CLI (rebase #287)

Re-land PR #287 (`feat/mobile-terminal-handoff`) on current `main`:
Bionic `android-arm64`/`android-x64` targets in build, release, checksums,
npm optional packages, `install.sh` Termux detection (`$TERMUX_VERSION` /
Termux `$PREFIX`), upgrade asset selection, `--player auto|mpv|vlc`,
detached-handoff result modelling (no invented progress/EOF/completion),
managed-only controls disabled with an explanation.

Done when: CI builds both Android targets, the compiled smoke runs under the
host for every non-Android target, unit/integration suites pass, and the
physical-device checklist from #287 is published as an issue for a tester.

## M2 — Android stream gateway

PR #629 remains in review. The continuation on 2026-10-12 reproduced and
fixed idle shutdown during progressive responses, chooser subtitle loss,
blocked playlist/MPD targets escaping to the external player, and a first-chunk
playlist size-limit bypass. Upstream DASH now resolves relative hierarchical
BaseURLs and inherited SegmentBase/List/Template references against the final
manifest URL. Segment substitutions use guarded session routes; unsupported
XML/DRM/external-resource forms are refused with a sanitized 422. Generated
deferred MPDs share the same rewriter. The architecture doc owns the supported
forms and bounds. Independent review is complete; final hosted gates and
physical-device proof remain outstanding. M3 and M4 have not started.

Generalize `hls-relay.ts` into a handoff gateway used when the player cannot
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

## M3 — `kunai serve`: the phone web surface

`kunai serve [--port N] [--open] [--no-open]`

- Server: `Bun.serve` in the app layer (`apps/cli/src/app/serve/`), using the
  same container/services as the shell. Binds `127.0.0.1` only. Prints the URL
  and, on Termux, opens it with `termux-open-url` unless `--no-open`.
- Auth: a random 128-bit token minted per run, delivered once in the opened
  URL fragment (`/#t=…`) and exchanged for an `HttpOnly; SameSite=Strict`
  cookie. Every API call requires it. Reject requests whose `Host` is not the
  bound loopback host:port (DNS rebinding) and whose `Origin` is not the
  server's own origin. No CORS headers.
- UI: a single-page app embedded in the binary through Bun's HTML import
  (`import app from "./web/index.html"` + `routes`), so `bun build --compile`
  carries it. React DOM (same React as the shell), CSS variables generated
  from `@kunai/design` tokens (themes included), no external fonts or CDNs —
  it must work offline.
- Screens (touch-first, one hand): Home (continue watching, Up Next, new
  episodes, downloads), Search with mode switch (series / anime / YouTube),
  Title (seasons, episodes, sub/dub, quality), Now playing (handoff status,
  next episode, mark watched), Downloads, Settings (subset: player, quality,
  language, theme).
- Play: the server resolves through the normal playback services and launches
  the player by intent (M2 gateway when headers are needed). The page never
  receives raw stream URLs or headers.
- Detached playback honesty: the web UI shows "handed to VLC" — progress is
  only recorded when the user confirms position or marks watched, matching
  #287's detached model.

Desktop gets the same command: `kunai serve` plays in mpv and is a pleasant
mouse/touch UI on the same machine. LAN pairing (QR, device list, revoke) is
**out of scope** here; it is a later plan because it changes the threat model.

## M4 — Install and onboarding on Android

- `install.sh` path for Termux (from M1) plus a one-screen doc:
  `pkg install curl` → install script → `kunai serve`.
- `kunai doctor` reports Termux, VLC/mpv-android presence (via
  `pm list packages` where available) and wake-lock advice.
- Docs: `docs/users/android.mdx` (new), platform matrix row moves from
  "Not supported yet" to "Preview" only after a physical-device pass.

## Verification

- Unit: gateway URL rewriting (master/media/key/relative/byte-range),
  allowlist, token gating, header injection, range passthrough; serve auth
  (token, Host, Origin), API handlers over an isolated container.
- Integration: gateway against a local fake CDN that requires Referer and
  serves HLS + MP4 with ranges; `kunai serve` end-to-end with an HTTP client
  against `createIsolatedContainer`.
- Agent: `agent:drive` for the TUI paths; a headless browser pass over
  `kunai serve` for the web UI.
- Physical: ARM64 phone, Termux, VLC and mpv-android, one anime and one TMDB
  provider that need headers.
