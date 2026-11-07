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

## 1. Watching release gates

- [ ] Integrate the pending mobile readiness docs (PR #672), project previews
      (PR #673) and the Android handoff lifecycle repair after exact-head checks
      and actionable reviews. Review any integration conflicts.
- [ ] Implement the approved movie qualification policy: Inception and Fight
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
- [ ] Produce simple Android install/use/recovery instructions and an explicitly
      experimental iOS installation path; avoid presenting unpublished artifacts
      as downloadable releases or requiring unnecessary runtime dependencies.
- [ ] At the final device pass, test physical Android ARM64 search-to-play,
      both players, chooser cancellation, headered media, subtitles and storage;
      test the accepted iOS host scope separately. Capture redacted evidence.

## 3. Real Kitty and modern terminal interaction

- [ ] Use the `verify-kunai` skill and a dedicated Kitty window with an isolated
      profile. Do not send keys to the maintainer's existing sessions or alter
      their profile. Capture frames and backend state before fixing defects.
- [ ] Exercise first run, search editing, debounce and mode-specific history,
      arrow navigation, suggestions, hover detail previews, thumbnails, Tracks,
      quality/Auto, subtitles/Off, failure recovery, queue, downloads and relaunch.
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
