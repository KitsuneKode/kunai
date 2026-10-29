---
status: active
created: "2026-10-27"
---

# Remaining release, mobile and experience work

This is the execution checklist for the maintainer's continuing requests in
the release-readiness thread. It contains unfinished work only. Source and
owning `.docs/` contracts remain authoritative; a checked local test is not a
hosted, device or release signoff.

## Decisions to retain

- Ship stabilized watching as 0.4.0 first. Chromecast is explicitly deferred.
- Android is a useful watching target through the real CLI in Termux, with
  search, providers and player handoff; do not duplicate it in the small
  `apps/mobile` host proof. Keep iOS's a-Shell/VLC route explicitly experimental.
- The maintainer has both Android and iOS phones. Install and physical testing
  are deliberately reserved for a dedicated final pass, after implementation
  and automated preparation. This deferral does not waive device qualification.
- Qualify working movie controls plus honest missing-title and fallback
  checks. Never pass a configured provider by substituting another provider.
- Keep production analytics and live profiles out of all tests, recordings
  and demos. Use isolated storage, file credentials and `DO_NOT_TRACK=1`.
- Use few agents. Prefer focused changes and primary-source research over
  speculative rewrites, dependency churn or unverified feature claims.
- Verify each bounded work batch first, consolidate reproducible findings and
  attempted disproofs, then fix the batch. Preserve evidence before changing code;
  do not turn uncertain observations into reactive patches.

## 1. Watching release gates

- [ ] Integrate and qualify the review correction batch on PR #676 after
      exact-head hosted checks. Local regressions now cover YouTube query
      dispatch and configured draft routing, keyboard-only consent/destructive
      actions, palette pointer ownership, exact live formats, bounded discovery
      and compound genre removal. The Kitty witness excludes intro skips and
      missing IPC intervals. Offline title-group actions now share the existing
      router, preserving diagnostics and repairing metadata before shelf refresh.
      The original 3120 KiB cap is restored; the measured bundle is 3,193,265
      bytes (1,615 bytes below it). Forced tests and the native/docs builds pass;
      these checks do not qualify live providers or physical devices.

- [ ] Persist explicit embedded mpv audio-language changes across autoplay.
      Provider audio picks already set session preferences; the native `a`
      branch only cycles mpv's current file and its track-change hook currently
      records diagnostics without updating the session language.

- [ ] Reconcile the provider audit branch now integrated into PR #676. Preserve
      its YouTube format ordering and VidRock concurrency fixes; qualify
      recommended-tier promotions with captured playback evidence rather than
      manifest flags. The review corrections cover per-file cache policies,
      cache-pause-independent recovery, private Kitty IPC/logging, VidRock
      decrypt accounting, docked Kanna dismissal and route-builder consistency.

- [ ] Integrate the pending mobile readiness docs (PR #672), project previews
      (PR #673) and the Android handoff lifecycle repair after exact-head checks
      and actionable reviews. Review any integration conflicts.
- [ ] Integrate and qualify the schema-2 movie policy: Inception and Fight
      Club controls, existing series/anime controls, Dune availability diagnostic,
      deterministic fallback and health-neutral missing-title regressions.
      Reject legacy/incomplete evidence, transport errors disguised as absence,
      and mismatched default providers. Update every artifact reader and doc.
- [ ] Collect fresh hosted evidence for the integrated release candidate.
      Keep reachability, decoded playback and physical-device proof distinct.
- [ ] Finish npm trusted-publishing bootstrap for the Android package names
      and verify all platform package/workflow/environment bindings. Do not
      create placeholder releases or bypass the protected release gates.
- [ ] Recheck remaining GitHub issues and Linear tickets against merged source
      and actual acceptance evidence. Close only proved work; retain unknown
      installer contention, device testing and unverified external marketing work.
- [ ] Recheck open PR dependency order, unpushed work and worktree ownership.
      Reclaim only approved safe artifacts/checkouts after preserving unique work.

## 2. Functional Android and mobile distribution

- [ ] Finish cancellation, shutdown, output bounds and deadline handling for
      Android player launch; prove cleanup and a subsequent successful retry.
- [ ] Review the complete Termux install, update, rollback and uninstall route,
      architecture selection, executable storage and actionable doctor output.
- [ ] Audit download directory defaults, path overrides, permissions, free-space
      failures, interrupted downloads and offline playback on each platform.
      Do not advertise Android local-file handoff until it is implemented.
- [ ] Trace Android YouTube/yt-dlp limitations and define a working handoff
      contract before lifting refusals. Preserve exact format/client choices,
      request headers, subtitles and the provider probe gate.
- [ ] Keep explicit VLC, mpv-android and chooser behavior truthful; qualify
      gateway lifetime, Range/seek, subtitles, app return and backgrounding.
      Desktop VLC support is separate work, not implied by Android intents.
- [ ] Research MovieBox-TUI's actual mobile/distribution implementation and
      identify transferable behavior with source links, license obligations and
      verification limits. Do not infer reliability from popularity alone.
- [ ] Compare the current production roster with FMHY's video catalog, then
      qualify only promising additions through the existing provider intake
      process. Prioritize working delivery and useful source/quality/subtitle
      coverage; a directory listing is not playback evidence.
- [ ] Produce simple Android install/use/recovery instructions and an explicitly
      experimental iOS installation path; avoid presenting unpublished artifacts
      as downloadable releases or requiring unnecessary runtime dependencies.
- [ ] At the final device pass, test physical Android ARM64 search-to-play,
      both players, chooser cancellation, headered media, subtitles and storage;
      test the accepted iOS host scope separately. Capture redacted evidence.

## 3. Real Kitty and modern terminal interaction

- [ ] Integrate the visual verification skill and Kitty driver after its own
      launch/doctor/action/capture/cleanup cycle is proved. Keep PNG inspection,
      terminal text, persisted state, mpv decoding and native OS pointer input
      as separate evidence. Use small models for bounded source research and
      one coordinator for serial desktop control.
- [ ] Qualify the remaining failures from the 2026-10-28 serial 16-route live
      pass: YouTube media starvation, Videasy seed availability, VidRock startup,
      AllManga captcha refusal, Miruro deadline and Movy movie black frames.
      Separate Movy-series/AnimeGG capture deadlines from provider failures;
      fix and recheck the screenshot/cleanup lifecycle before certifying them.
      Retain first failures and exact candidate identity. Do not let fallback,
      moving audio clocks, screenshot-file existence or fixtures mark video healthy.
- [ ] Audit pointer coverage per surface, then fix reproduced omissions through
      shared keyboard/controller actions. Verify Browse footers and home rows,
      both click stages, changed targets, overlays and narrow layouts; retain
      Calendar/history/notification/download action gaps until separately proved.
- [ ] Use the `verify-kunai` skill and a dedicated Kitty window with an isolated
      profile. Do not send keys to the maintainer's existing sessions or alter
      their profile. Capture frames and backend state before fixing defects.
      Use real providers and titles on a free display/workspace. The latest
      preference is to avoid disturbing the display currently in use; confirm
      the free display when desktop activity changes. The maintainer reserved
      eDP-1 workspace 9 on 2026-10-28. Confirm the owned native window's actual
      placement before input; runner placement rules alone are insufficient.
      Keep fixture regressions separate
      from that live manual session. Ensure the QA launcher does not inherit
      `NO_COLOR=1`; select the maintainer's installed terminal font rather than
      relying on this machine's CJK monospace fallback.
- [ ] Exercise first run, search editing, debounce and mode-specific history,
      arrow navigation, suggestions, hover detail previews, thumbnails, Tracks,
      quality/Auto, subtitles/Off, failure recovery, queue, downloads and relaunch.
- [ ] Keep progressive home content scoped to the active mode: most recent
      unfinished title, saved suggestions and discovery, including YouTube.
      Verify empty history, switching away and back, older matching rows behind
      another mode's activity, and stale responses after a mode/provider change.
      Preserve the global queue's playback order; never reorder it for a home row.
- [ ] Inspect narrow and normal terminal sizes, keyboard/mouse equivalence,
      focus and selection feedback, overlay cancellation and terminal cleanup.
- [ ] Research the official Kitty graphics protocol: placement lifecycle,
      deletion, clipping, image transport, animation, tmux/SSH behavior and
      fallbacks. Measure bytes, latency, CPU/RSS and terminal repaint behavior
      before adding animation or new dependencies.
- [ ] Apply the requested interaction-design and make-interfaces-feel-better
      skills to reproduced friction. Preserve readable text and reduced-motion
      fallbacks; do not make animation a prerequisite for use.

## 4. Website navigation, SEO and polish

- [ ] Qualify the mobile/tablet menu (all destinations), scroll/hover/focus desktop
      compaction and compact Search in a real browser. Source and regression tests
      are implemented; browser attachment is unavailable in the current session.
- [ ] Visually qualify stationary mobile/reduced-motion Kanna and restore/pause
      controls. Visibility regression tests pass; real-device/browser checks remain.

- [ ] Complete the workshop website destinations and local link previews from
      the requested Aceternity/Animate UI patterns, with keyboard/touch/error
      states and no runtime screenshot-service requests.
- [ ] Improve the floating navbar's compact state: hide secondary items when
      appropriate, expand on intentional hover and keyboard focus, retain
      navigability on touch and avoid focus loss or moving click targets.
- [ ] Reduce compact Search to a clear platform-correct Cmd/Ctrl+K keyboard
      affordance using the existing shadcn component conventions. Keep a named
      clickable search trigger and the same accessible search dialog.
- [ ] Apply the explicitly requested shadcn, emil-design-eng, transitions-dev,
      animate and animation-vocabulary skills. Name the interaction precisely,
      support interruption and reduced motion, and verify in a browser.
- [ ] Re-audit the deployed and generated sitemap, robots/canonical URLs,
      indexability, redirects, last-modified dates, metadata and social previews.
      Verify SEO/AEO content against actual supported product behavior; no
      keyword stuffing, invented schema claims or ranking guarantees.
- [ ] Review README/npm/GitHub About conversion copy against the earlier
      version, preserving accurate install commands, examples and feature limits.
      Resolve review findings before publishing further changes.

## 5. Quality, performance and walkthrough

- [ ] Audit runtime/package advisories, dependency freshness, TypeScript/Bun/Ink
      compatibility, lint debt and build graph. Upgrade for concrete benefit
      with regression evidence; do not raise size budgets to hide growth.
- [ ] Measure startup/search/render/image behavior and memory over repeated
      transitions; audit listener/timer/process/reader cleanup at real boundaries.
- [ ] Compare compressed distribution size and install behavior per target.
      Embedded runtime size, app bundle size and npm launcher size are distinct.
- [ ] Prepare a short reproducible walkthrough script for the maintainer to
      record: search, source/quality/subtitle choices, recovery, resume/queue and
      downloads. Use an isolated profile and licensed/tester-owned media; show
      only verified features and keep credentials/private history out of frames.
- [ ] Record remaining work after 0.4.0: manga/comic reading, expanded YouTube
      channels/trending/recommendations, live TV/sports and other larger features.
      These are not prerequisites for the stabilized watching release.

## Evidence and completion rule

Each implementation should link its focused PR and record the exact local
verification, skips and unresolved external gates. Remove landed implementation
checklists in favor of the merged PR record; archive this plan when only a
smaller clearly routed residue remains. Do not mark a feature complete merely
because a callback fired, a capability was declared, or a fixture passed.
