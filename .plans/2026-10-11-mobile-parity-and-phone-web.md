---
status: active
created: "2026-10-11"
---

# Mobile parity and the phone web surface

Goal: a phone user gets the same catalog, providers, history, Up Next and
downloads as a desktop user, without learning a terminal UI on a touch
keyboard. Android first (Termux); iOS stays on the `apps/mobile` a-Shell
preview until Android is qualified.

## 0.4.0 scope checkpoint (2026-10-27)

Android watching and the experimental iOS host/VLC preview are the accepted
release scope. Physical Android qualification in #631, package publication and
iOS device qualification remain open. Full iOS search/providers, native store
apps and the M3 phone web UI are later work.
The [Android guide](../docs/users/android.mdx) distinguishes the real CLI
from the Node host proof and states that staged assets are not public.

## Design direction

Use the real CLI for the Android watching route. Keep the Node/a-Shell host
proof separate; do not duplicate catalog and provider behavior there. The
remaining touch UI should run on the phone through loopback, with no hosted
resolver or shared media service. This follows the local-only direction in
[kunai-experience-and-growth-moat.md](./kunai-experience-and-growth-moat.md).

## Non-negotiables this plan must keep

- The shared relay stays metadata-only. The existing stream gateway is a
  **per-process loopback** server on the device that runs the player — the
  same category as `hls-relay.ts`, never a hosted or LAN-exposed media route.
- Every handed-off stream is still the candidate `verifyCandidateStream`
  probed; the gateway forwards exactly that request shape.
- No new analytics, no install id, no shared URLs baked into binaries.
- One desktop entrypoint: the proposed `kunai serve` must be a subcommand of
  `apps/cli/src/main.ts`, not a new binary.
- Concurrent TUI + `serve` on one profile follows ADR 0003.

## 0.4.0 qualification and publication

The implemented M1/M2 core is recorded in the
[archive](../.archive/plans/2026-10-11-mobile-m1-m2-implemented-core.md).
Current gateway and handoff contracts belong to
[architecture](../.docs/architecture.md) and
[mobile terminal runtime](../.docs/mobile-terminal-runtime.md).

- [ ] Collect exact-candidate hosted build evidence for both Android targets.
      Host execution of other platform binaries is not an Android device pass.
- [ ] Qualify the real CLI on physical ARM64 Termux with VLC and mpv-android:
      search, provider resolution, headers/cookies, subtitles, chooser refusal,
      return to Termux, backgrounding and gateway shutdown. Keep #631 open until
      its acceptance evidence is complete.
- [ ] Finish Android package publication and verify install/update/rollback
      against public artifacts. Staged binaries and local builds are not a
      public installation channel.
- [ ] Qualify the separate iOS a-Shell/VLC host preview with the device lab.
      Do not imply full iOS search/providers or background playback support.

## M3 — Proposed `kunai serve`: the phone web surface (after 0.4.0)

This command and web surface are unimplemented design work, not an available
installation or playback path.

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

## M4 — Qualify installation and onboarding on Android

- [ ] Exercise the published Termux installer, executable storage, architecture
      selection, update, rollback and uninstall; keep the documented public
      install commands conditional until Android artifacts exist.
- [ ] Verify doctor output on the phone for Termux, VLC/mpv-android detection and
      wake-lock advice, including unavailable Android package-query commands.
- [ ] Reconcile `docs/users/android.mdx` and the platform matrix with the physical
      evidence. Keep `kunai serve` instructions out of the current TUI install
      flow until M3 is implemented and qualified.

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
