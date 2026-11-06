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
      The source now enforces a 3210 KiB cap. The November companion batch keeps
      that cap and compresses its embedded page at build time; rerun the complete
      build for exact candidate bytes. Earlier 3120 KiB measurements describe an
      older tree and are not current qualification evidence.

- [ ] Integrate and qualify the [desktop, Android and companion batch](2026-11-04-desktop-android-companion.md).
      It implements session-only native audio intent across same-title restart
      and autoplay, verified local-file handoff and authenticated companion
      consumers. Hosted integration and physical-device evidence remain open.

- [x] Integrate the provider owner's source through the updated #676 base
      `fix/kitty-verification-pointer-20261028` at `eb6f43546` into #677.
      The earlier separate-branch prerequisite is superseded.

- [ ] Qualify the integrated provider candidate. Preserve
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

- [ ] Integrate Android launch and token-lifecycle repairs, then qualify them on
      hardware. Automated regressions cover cancellation, replacement, late
      failures, bounded launch output and retry without revoking a successor.
- [ ] Review the complete Termux install, update, rollback and uninstall route,
      architecture selection, executable storage and actionable doctor output.
- [ ] Audit download directory defaults, path overrides, permissions, free-space
      failures, interrupted downloads and offline playback on each platform.
      Local-file handoff is implemented in the November batch; physical Android
      decoding, background behavior and storage qualification remain pending.
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

## 6. Launch acceptance bar — 2026-11-06

The maintainer's goal is a system above 9.5/10. Treat that as a quality target,
not a score inferred from unit-test counts or a promise of provider uptime.
Pass every critical gate below before advertising the corresponding platform.
An unresolved security, playback or data-loss defect blocks that platform;
averaging stronger areas cannot cancel it out. Virality is a growth hypothesis,
not a release acceptance criterion or a guaranteed outcome.

### Reliability and verification

- [ ] Close reproduced provider-review gaps before promotion: malformed HLS
      soft-acceptance, skipped same-host qualities after a failed hedge,
      dormant direct-helper hedging, unconnected faceted controls, broken
      verification flags and missing-artifact false passes. Apply fixes through
      the provider owner and the integrated candidate, preserving both branches.
- [ ] Replace fragile hedge wall-clock assertions with controlled timers,
      deferred probes and explicit ordering. Confirm tests fail when the
      protected behavior is deliberately removed. Retain privacy, cancellation,
      installer and platform coverage; remove only demonstrated duplicates or
      unused experimental support, with its intended home recorded.
- [ ] Predeclare a live matrix spanning movie, series, anime and YouTube,
      including representative titles, known-working controls and honest
      missing-title cases. Record every attempt and provider identity. Report
      first-choice success, fallback recovery and catalog absence separately;
      retain failures rather than selecting only successful examples.
- [ ] For recommended routes, capture at least 45 seconds of sustained decoded
      playback and inspect a real frame, audio and subtitles. Add a ten-minute
      soak per supported mode with seek, next/back, reconnect and resume cases.
      These are pending qualification targets, not current measurements.
- [ ] Bind hosted checks, review scope, live evidence and distribution hashes
      to one integrated candidate. Cross-compilation, old approval and a
      successful HTTP probe remain separate evidence tiers.

### Installation, performance and usability

- [ ] Verify clean install, first launch, missing-player recovery, update,
      rollback and removal for every advertised OS/architecture. Publish exact
      support tiers: tested, experimental or unsupported. An untested target
      must not inherit another platform's qualification.
- [ ] Run a first-use walkthrough with a fresh user: choose platform, install,
      find a title, start playback and recover from one unavailable source.
      Record prerequisites, steps, download size and time to first decoded
      frame. Simplify the steps users actually get stuck on before launch.
- [ ] Measure cold/warm startup, search latency, first decoded frame, memory,
      CPU and artifact sizes on named devices. Record median/tail observations
      and sample counts separately from fixture timing. Agree budgets before
      qualification, preserve the current release size cap and reduce measured
      duplication before importing a larger provider/UI graph.
- [ ] Reach every advertised control through the real keyboard/mouse/touch
      route, including mode switching, previews, filters, quality, subtitles,
      offline playback and recovery. Include narrow screens, reduced motion,
      readable focus, empty results and delayed/stale responses.

### Mobile and companion route without a new native Kunai app

- [ ] Qualify the full Android CLI in Termux with VLC, mpv-android and chooser,
      including headered streams, sidecars, offline files, backgrounding and
      returning to the shell. Provide one current install route after Android
      assets are published, plus a separately named candidate route beforehand.
- [ ] Qualify the Android-hosted companion in that phone's browser. It already
      reuses the CLI catalog and playback services; full home/history/queue/
      download/settings parity is additional work, not implied by search/play.
- [ ] Retain the approved iOS experimental host-preview label until its physical
      pass. Full iPhone watching without a new native app is a separate browser
      companion milestone; the a-Shell proof has no search/providers.
- [ ] Design and qualify cross-device pairing before promising desktop-to-phone
      access. Current `kunai serve` binds loopback and serves the same device.
      Specify private addressing/HTTPS, explicit expiring pairing, revocation,
      trusted origins, per-session media capabilities and browser codec refusal.
      Keep published relay traffic metadata-only. This checklist does not
      authorize exposing the existing service on all network interfaces.

Current browser constraints inform that milestone: Chrome gates public-site
requests to local devices behind secure-context permissions
([Chrome guidance](https://developer.chrome.com/blog/local-network-access)).
iOS media presentation and autoplay policies require real Safari qualification
([WebKit guidance](https://webkit.org/blog/6784/new-video-policies-for-ios/)).
Use feature detection and an explicit Play action, then test actual codecs,
subtitles, seek and suspend/resume on the user's phones.

### Launch and later TV route

- [ ] Record a short real walkthrough after qualification: search, preview,
      play, language/subtitles, recovery, resume/offline and Android handoff.
      Use authorized media and an isolated profile. Link the demonstrated
      candidate and give each platform a clear install call to action.
- [ ] Align README, GitHub About, docs, install page and social preview with the
      same supported features and limits. Measure first-play completion,
      successful recovery and voluntary feedback; preserve opt-in analytics.
      Stars, forks and traffic are outcomes to observe, not substitutes for
      successful watching or numbers to promise.
- [ ] Investigate TV only after desktop/mobile launch. First test a browser
      companion on a named TV with remote-control focus, Back behavior,
      subtitles, codec support and session pairing; reuse the existing core.
      Samsung's documented web engines vary by model year
      ([specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)).
      Web-app API support does not itself qualify the consumer TV browser.
      Keep model-specific failures explicit; no universal TV compatibility,
      dedicated TV app, store submission or Chromecast delivery is promised.

## Startup and first-use follow-up — 2026-11-06

The current setup pass leads with capabilities, exposes customization versus
reviewing recommendations, and labels the final write explicitly. Preserve
the six-screen behavior and consent/abort/restore contracts while evaluating
the remaining first-use flow with fresh users.

Linux/Bun 1.4.4 measurements on fresh isolated profiles with a warm filesystem
cache recorded a median **252 ms** to the existing shell-mounted diagnostic
(five real held PTYs, range 249–265 ms). This milestone follows Ink render
invocation; it is not exact first paint or time to video. Evidence lives in
`/home/kitsunekode/.t3/scratch/kunai-startup-onboarding-20261106/startup/`.

- [ ] Profile populated-history upgrades, returning-user startup, cold storage,
      Windows/macOS and long-session memory before setting startup budgets.
- [ ] Evaluate a lightweight short-command entry path. A source `--help`
      prototype reduced median command time from 116.67 ms to 17.10 ms across
      nine runs with identical output; it is not implemented and does not
      improve interactive shell startup. Preserve the sole desktop entrypoint.
- [ ] Narrow provider barrel imports only after whole-graph measurement and
      coordination with the provider owner. Existing adapter imports already
      run concurrently; an extra lazy wrapper alone does not isolate them.
- [ ] Preserve the bundle cap. The current single-file build does not split
      runtime code merely because it uses dynamic imports. Do not trade a
      measured dependency or migration check for an unmeasured latency claim.

## Evidence and completion rule

Each implementation should link its focused PR and record the exact local
verification, skips and unresolved external gates. Remove landed implementation
checklists in favor of the merged PR record; archive this plan when only a
smaller clearly routed residue remains. Do not mark a feature complete merely
because a callback fired, a capability was declared, or a fixture passed.
