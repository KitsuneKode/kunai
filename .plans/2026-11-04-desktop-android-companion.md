---
status: active
created: "2026-11-04"
---

# Desktop, Android and local companion implementation plan

**Goal:** Complete the launch-critical desktop and Android paths and replace the
reachable companion's placeholder behavior with real, authenticated local actions.

**Architecture:** Reuse the existing container, search registry, provider engine
and player/gateway services. Provider adapters are owned by another agent and
remain outside this batch. The companion runs on the same device as Kunai; the
shared relay remains metadata-only. Android uses Termux plus an external player.

**Tech stack:** Bun, TypeScript, existing Ink shell, embedded companion HTML and mpv.

**Spec:** Existing mobile contract in
[phone-web plan](2026-10-11-mobile-parity-and-phone-web.md) and the maintainer's
approved [release work](2026-10-27-release-mobile-and-experience.md).

## Constraints and ownership

- Base: PR #676 at `176fa2ae1577129e6d72943110aca7326df0946e`.
- This batch is isolated on `fix/desktop-android-companion-20261104`.
- No edits to `packages/providers`, provider dossiers or upstream qualification.
- No tests/debug runs against the real profile; use storageRootEnv, file
  credentials and DO_NOT_TRACK=1. Do not create analytics consent or identifiers.
- Companion APIs bind numeric loopback, require a per-run secret and validate
  Host/Origin. No arbitrary URL proxy or fabricated provider-health success.
- Preserve candidate URL/headers/subtitle identity through the existing gateway.
- Physical Android/iOS tests remain the final dedicated pass; automate preparation
  and keep unsupported capabilities explicit until that evidence exists.

## Tasks

- [x] Desktop: reproduce missing embedded audio intent persistence; persist only
      explicit choices, preserve automatic/default selection and reject stale
      playback-generation observations. Test restart/reset and autoplay readers.
      Owner: desktop agent; playback bridge/event/intent files and focused tests.
- [x] Android: support authorized local offline files/sidecars through revocable
      loopback gateway sessions with Range/HEAD/missing-file guards and cleanup.
      Test launch cancellation and retry; inspect download storage defaults.
      Owner: Android agent; stream-gateway, handoff service and focused tests.
- [x] Companion: replace the unsafe/stub server with small application/session
      modules. Test authentication, host/origin rejection, bounded mode-specific
      search, real episode identity, engine-resolved streams and failure states.
      Expose working browser/local-player behavior; reject unavailable controls.
      Owner: coordinator; services/web-companion and embedded HTML.
- [x] Companion interaction: cancel stale search/episode/stream requests, keep
      mode state separate, escape provider text, provide keyboard/touch targets
      and reverse/close/stop behavior. Verify actual browser behavior if available.
- [x] Update feature map, mobile/companion behavior docs and the master release
      task list. Reconcile old version-PR and size claims with current source.
- [x] Run focused red/green regressions, uncached typecheck/lint/tests and build,
      doc verifiers, captured real mpv/Kitty playback and cleanup. Preserve failures
      and distinguish local, native, upstream and physical-device qualification.
- [ ] Integrate this batch stacked on #676 after exact-head hosted checks;
      preserve the provider agent's branch changes through normal integration.

## Review focus

- Startup audio observations must not overwrite an explicit preferred language.
- Android local tokens authorize exactly one known file, never caller paths.
- Closing/replacing a companion title aborts stale work and revokes media sessions.
- Browser decode failure has a useful external-player route without claiming success.
- No HTTP success is reported for placeholder episodes, streams or player controls.

## Verification commands

Use `bun run test:cli:file <focused paths>`, then `bun run test --force
--concurrency=1`, `bun run typecheck --force --concurrency=1`, `bun run lint
--force --concurrency=1`, `bun run fmt`, `bun run verify:doc-paths` and `bun run
build --force --concurrency=1`. Run the companion integration suite with isolated
in-memory ports before an isolated production-container smoke. Real Kitty/mpv
runs follow `.agents/skills/verify-kunai/SKILL.md` and require actual frame review.

## Integration checkpoint — 2026-11-05

The partial agents' edits have been continued and reviewed in this branch.
Do not reimplement audio intent, local file serving, Android token lifecycle or
companion authentication/catalog/player wiring. Continue from the diff and its
regression suites. No provider adapter was changed.

Local qualification now includes the real isolated-container HTTP boundary,
source and release-built companion interaction tests, and inspected VidLink
Inception playback in Kitty/mpv on eDP-1 workspace 9. The live sample recorded
52,145 ms elapsed and 45,077 ms accumulated advancement at 1920×1080. The decoded
frame showed film content; the TUI showed Playing. Cleanup confirmed no analytics
identity, exited children and removal of the isolated profile. This qualifies one
movie control only. Browser checks exercised real YouTube search, 16:9 thumbnails,
mode-specific queries and the honest external-player route for yt-dlp media.

Uncached tests passed 26 workspace tasks (CLI integration: 417 pass, 27 skip);
uncached typecheck/lint, preflight, doc routing and release guards passed. The
complete build passed all 10 tasks, including the Linux x64 executable. The Bun
app bundle is 3,278,235 bytes under the unchanged 3210 KiB cap. These local
results do not replace hosted or hardware evidence.

Remaining release gates are exact-head hosted CI, the provider owner's broader
live matrix, physical Android/iOS installation and decoding, and protected release
publication. Full companion parity (home/history/queue/download/settings) and
browser codec coverage remain future work, not completed by the search/play slice.

## Documentation reconciliation — 2026-11-04

The architecture and public CLI/install docs now distinguish the implemented
slice from release qualification:

- Explicit embedded-audio intent updates only session preferences; default
  observations do not, and content reset clears the choice.
- Authorized offline files and sidecars are served through revocable loopback
  tokens, with file-identity and Range/HEAD checks. External launch acceptance
  remains distinct from decoded playback.
- The companion is same-device, loopback-only, authenticated, and uses the real
  search/episode/resolve/player consumers. Its media gateway has narrow CORS for
  the exact browser origin; APIs remain same-origin. No LAN pairing or arbitrary
  proxy is exposed.
- Full shell parity, browser codec coverage, native playback captures and
  physical-phone qualification remain explicit residue. The coordinator owns
  verification claims and the final task checkboxes.
