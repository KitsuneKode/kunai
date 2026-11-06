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

## Review corrections and delegated verification — 2026-11-05

PR #677 review at aed24a230 has 13 behavior findings plus two coverage requests.
Keep the existing implementation; fix reproduced gaps rather than redoing it.

- [x] Replace port-agnostic cookie authorization with an explicit page credential;
      retain exact Host/Origin checks and capability-token media routes. Scope
      release to the requested media generation so stale pages cannot revoke a
      successor. Normalize default HTTP ports through URL parsing.
- [x] Cover audio intent across same-URL reconnect, prefetch and recent-episode
      reuse; investigate the Lua replacement race against real mpv behavior.
- [x] Normalize new download paths; decide existing-relative compatibility.
      Cancel in-flight local transfers when their token is revoked. Browser
      subtitles require verified WebVTT or an honest unsupported-format result.
- [x] Cover delayed dialog close/reopen, long episode catalogs and selected-season
      retry. Prove the release-built page uses compression and the real action
      paths receive explicit audio intent.
- [x] Improve and actually invoke verify-kunai with a bounded AGY Gemini 3.8
      High verification task, recording exact provider/model and evidence. The
      available catalog variant is Gemini 3.8 Flash (High).
- [x] Prepare easy, version-pinned phone installation and evidence collection.
      Physical Android/iOS execution is the maintainer's final pass; candidate
      downloads must not imply an unpublished release is publicly available.

The first two native correction workers hit their provider's usage limit before
making edits. Continue their findings; no runtime correction has been applied
at this checkpoint. The review findings were fetched from GitHub and preserved
in the coordinator's durable evidence directory for per-item decisions.

### Coordinator continuation after AGY result

AGY changed the verification skill and invoked replay, isolated HTTP and Kitty
on candidate `aed24a230` with a dirty tree. Its new live VidLink row failed the
strict sustained-advancement gate (7,874 ms credited over 75,090 ms elapsed),
despite reaching position 98.536. Preserve that failure; earlier base captures
are historical and cannot qualify the changed candidate.
Evidence: `/home/kitsunekode/.t3/scratch/kunai-agy-verification-20261105-095833/`.

The coordinator corrected the runbook's full-CLI versus `apps/mobile` artifact
confusion, removed broad process-kill/profile-deletion instructions and fixed
numeric loopback/port-80 examples. Reusable registration checks derive provider
IDs from the actual loader instead of hardcoding a stale branch roster.

Source corrections now cover review IDs 4473967282/7324/7332 (canonical authority,
media generation release, explicit Bearer credentials), 4473967344/7356/7382
(delayed close, episode 1001, selected-season retry) and the compression proof.
Focused local suites: 16 security/server tests, 12 shipped/compressed page tests,
and 5 HTTP/gateway/parser tests pass. Per-package CLI typecheck and skill/doc
validators pass. Audio, path/transfer and browser-subtitle corrections remain
pending; all final uncached/release-build/live/hosted gates must rerun afterward.

Path/transfer/subtitle review corrections are implemented locally: enqueue-time
absolute paths, fail-closed legacy relative artifacts, token-scoped cancellation
of active file readers, bounded WebVTT/SRT browser delivery and sanitized refusal
of unsupported formats. Native subtitle bytes stay unchanged. Download/gateway
regressions passed 151 tests; focused subtitle/local tests passed 36 tests. The
updated Bun bundle is 3,280,584 bytes under the unchanged 3210 KiB cap. Durable
coordinator logs and candidate state are under
`/home/kitsunekode/.t3/scratch/kunai-review-corrections-20261105/`.
The remaining runtime review group is explicit audio intent across replacement,
reconnect, prefetch and recent-episode reuse; final gates wait for that diff.

### Independent scoped review

Cursor Composer 2.5 (`fastMode: false`) reviewed the dirty companion, gateway,
subtitle and enqueue-path diff and reported no material findings. It reran 44
CLI and 10 relay focused tests. The review excluded audio and did not qualify
live providers or physical phones. Report:
`/home/kitsunekode/.t3/scratch/fix-watching-release-readiness-review-20261105/review-report.md`.
AGY is implementing the separate audio review group; combine its diff before
uncached global checks, compiled-artifact verification, a new sustained live
playback witness and any push. Do not rerun or replace the active audio task.

### Audio integration review

AGY completed the audio correction group. Coordinator review added a final
identity check after track-list reading and corrected the prefetch test to prove
an English bundle is actually ready before rejecting Japanese consumption.
The combined audio group passes 61 tests / 199 assertions, including execute-level
autoplay, reconnect alang and same-URL replacement schedules. The session profile
reader is a live snapshot function rather than duplicated getter objects.
Global checks and live/compiled qualification still follow this checkpoint.

### Combined qualification results

Uncached checks: 26 test tasks passed (CLI unit 7,059 pass / 1 skip; integration
417 pass / 27 skip), 15 typecheck tasks, 14 lint tasks, 10 build tasks and 5 docs
build tasks. Preflight passed after correcting test assertions/config fields,
without changing the anti-slop baseline. The rebuilt binary smoke passed 13
cases with 1 explicit skip. The compiled companion accepted Bearer credentials
and refused cookie-only/foreign-origin requests. Real loopback mpv passed its
IPC plus history witnesses. Bun app bundle: 3,281,301 bytes under 3210 KiB.

Live VidLink remains UNQUALIFIED. An unchanged 100 ms witness credited 10,780 ms
in 75,037 ms despite reaching position 99.788. A separate 12-second diagnostic
recorded repeated clock values, batched jumps and an IPC timeout. One-second
witness windows reduce high-frequency undercounting while retaining elapsed,
progress and seek limits; the fresh run still failed (13,705 ms in 75,096 ms).
Keep both failures and raw samples. Do not declare provider drift, playback
success or release readiness from these observations. All owned windows stayed
on eDP-1/workspace 9; user focus remained outside them and cleanup passed.
The provider owner must complete the integrated live matrix before release.

Phone handoff artifacts were built locally, not published: ARM64 Android CLI
under `/home/kitsunekode/.t3/scratch/kunai-review-corrections-20261105/android-candidate/`
and separate `apps/mobile` host proofs copied to `mobile-host-proof/` beside it.
Both include SHA-256 manifests. Cross-compilation is not Android runtime or iOS
hardware qualification. The final focused audio/witness suite passed 56 tests.

### Hosted clean-checkout correction

Hosted Docs build and Docs coverage at f0c522be3 both failed the path verifier
before building: the generated mobile metadata file was present locally but
absent on a fresh runner. A temporary-filesystem regression reproduces that
absence while retaining a missing-source finding. Generated CLI/mobile dist
outputs now share the narrow build-output exemption. Path checks, coverage,
preflight and CLI typecheck pass; no application runtime or phone artifact
changed in this follow-up.

### Base integration — 2026-11-06

PR #677 now incorporates base branch `fix/kitty-verification-pointer-20261028`
at `eb6f43546`, including the provider owner's intervening work. The verification
skill was the sole textual conflict: retain the concise companion/mobile/audio
references and add the base's doctor, feature-map and evidence-survival routes.
The survival helper remains a diagnostic; inspect the retained PNG, text and
backend artifacts before claiming qualification.

This supersedes the earlier separate-branch prerequisite for this candidate.
Provider findings reported at `97c0b85db` need rechecking against the integrated
source. Neither the earlier #677 checks nor historical playback captures qualify
this new combination. The base also brings its bundle-budget change from
3210 to 3230 KiB; integration alone does not approve that change as a performance
improvement. Integrated runtime, live playback and phone signoff remain open.
