# Watching release candidate implementation plan

Status: IMPLEMENTED LOCALLY; release integration and external qualification pending.
Base: `8a86bf9dc`. This orders the authorized watching
work from the existing release-readiness and shell/provider plans; it does
not replace their remaining release qualification requirements.

**Goal:** Make choosing, starting, controlling, recovering, and resuming a
video dependable, with immediate truthful feedback and usable mouse input.

**Architecture:** Preserve the current Bun/Ink CLI, provider resolve gate,
direct-media transport, and SQLite authority. Integrate reviewed existing
patches by pinned PR head, repair reproduced review gaps, and qualify the
combined candidate. No new runtime abstraction or shell rewrite.

**Spec:** The maintainer's October 22 authorization in this thread, the
existing release-readiness plan, and the owning current feature docs.

Local source candidate: `cf83c5405`, including review and packaging corrections.
Verification and remaining gates are in
[the candidate record](../.release/watching-candidate-2026-10-22.md). Tasks 1–4
are implemented locally. Task 5 has a completed independent review with its cancellation finding fixed.
Upstream/host/device qualification and release integration remain open; no remote PR has been merged.

## Global constraints

- Exclude Chromecast, cloud expansion, torrent/debrid completion and licensing.
- Keep real profiles untouched; runtime proof uses isolated HOME, XDG,
  USERPROFILE and APPDATA plus file credentials. Never KUNAI_CONFIG_DIR.
- Keep analytics explicit-keystroke-only; passive changes cannot restore it.
- Keep relay metadata-only and its default URL empty; probe every stream.
- Preserve keyboard workflows, both anime/TMDB lanes, and platform contracts.
- Do not publish a release, merge remote PRs, or overwrite shared branches.
- Each worker owns its files in an isolated worktree, commits its changes,
  records exact tests/results and returns a commit; the controller integrates.
- Run focused failing-first regressions for new fixes, then uncached combined
  checks. No sleep-based tests, timeout increases, or hidden skipped gates.

## Review focus

Stale Settings panes, failure/retry consent chains, same-drain input,
foreign-origin credentials, EOF without progress, selected-cache recovery,
all-disabled provider lanes, and narrow terminal mouse coordinates.

### Task 1: Safety and playback integration

Consume pinned heads for PRs 652, 658–665. Inspect each diff/review before
integrating; do not transplant unrelated feature stacks. Resolve the two
outstanding 665 test objections with meaningful production-path coverage.
Keep the explicit combined build-budget measurement in 664. Cover downloads,
offline lookup, poster eviction, native-vault identity, Retry-After, EOF,
ready-header feedback and selected-cache fallback with their owning tests.
Run focused tests and per-package checks. Record original head SHAs and
integration conflicts. Output: a locally committed correctness baseline.

### Task 2: Consent and gateway credentials

Start from the plan base. Inspect/apply 655 and 657, then repair 655's
whole-snapshot writes, action refresh ordering, sibling withdrawal, and
failed-enable/explicit-disable/passive-save replay. Read the privacy contract
and actual ConfigService dirty-key merge semantics first. Keep unrelated
preferences and failed withdrawal retry intact. Cover both direct Settings
and theme/presence callers with isolated real persistence regressions.
Pin header admission across subtitles, manifests, segments and redirects.
Update owning docs/changesets. Return commits and focused test evidence.

### Task 3: Providers and timing

Inspect/apply the watching portions of 667, 634–637, 639 and 645 without the
licensing or torrent stacks. Resolve current review findings and conflicts;
do not claim CAPTCHA bootstrap establishes playable streams. Check current
primary source docs for IntroDB issue 666 and migrate introdb.ts to v4 with
correct response identity/shape handling and failure classification. Test
ordinary timing, missing/malformed data, cancellation and both media kinds.
Keep provider disable/re-enable effective across catalog/cache/fresh resolve.
Run focused provider/timing tests and bounded live checks in shadow storage.
Update owning docs/changesets and return commits with exact evidence/limits.

### Task 4: Mouse and input

Inspect/apply 622, 623, 633 and 644 in dependency order. Repair conflicts and
reviews against current main; preserve current semantic selection behavior.
Exercise Library, Up Next, Tracks and Settings mouse selection/activation,
scrolling, keyboard return, disabled rows, and latest-text Enter in a single
input drain. Reconcile with Task 2 consent persistence rather than copying
whole snapshots. Follow canonical terminal design boards and owning UX docs;
do not add web UI or a visual redesign. Run targeted tests and L2/L3 evidence
where available. Return commits, evidence and any missing surface coverage.

### Task 5: Combined review and qualification

Integrate all four tasks on this branch; review actual combined diff with a
fresh reviewer. Fix material findings and re-review the fix range. Run forced
typecheck/lint/test/build, formatter, doc paths/frontmatter/coverage, anti-slop
baseline and relevant binary/installer gates. Drive real CLI search → select
→ play → post-play/resume and mouse/input journeys in shadow profiles, at
narrow and normal widths, using verify-kunai evidence. Attempt real-mpv and
bounded live-provider checks; report missing hardware/network access exactly.
Reconcile roadmap claims touched by this change. Keep release PR 327 last,
physical Android proof and unexplained installer contention issue 650 explicit.
Record final SHA, artifact/evidence paths, green gates, failures and skips.

## October 22 follow-up — finish the testable candidate

The maintainer requested GPT 6.1 Sol for all further implementation/review.
Continue from 375acdc35; preserve original checkout and existing candidate.

6. Diagnose the outstanding Movy decode failure through the real production
   provider/mpv path. Repair reproduced adapter/request defects, retain the
   resolve probe gate, and make failures/fallback truthful. Bound live attempts;
   CAPTCHA/upstream unavailability is not proof of a missing implementation.
7. Reconcile installer issue650 with its actual captured error and current
   fixtures. Implement only reproduced defects; preserve missing historical
   evidence and do not close the issue or fabricate an attribution.
8. Make the existing manual sandbox launcher safe and usable for maintainer
   testing: redirect every profile root, force file credentials, validate
   ownership before destructive work, preserve unrelated paths, and explain a
   reliable test command. Test real shell invocation and profile isolation.
9. Integrate/review changes using GPT 6.1 Sol, rerun appropriate uncached gates
   and actual CLI/player checks, then provide exact instructions for trying it.
   Release publication/remote merge and physical-device proof remain separate.
