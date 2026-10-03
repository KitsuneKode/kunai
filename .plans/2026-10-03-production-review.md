# Production review and remaining release work — 2026-10-03

Status: mobile repair committed and opened as [PR #554](https://github.com/KitsuneKode/kunai/pull/554); CLI/storage and tooling repairs are committed on the review branch. Nothing merged, deployed or released.

This pass reviewed the feature map, subsystem contracts, source/callers/tests,
current main, open PR and issue inventories, selected CI failures, provider
status publication, packaging and mobile host boundaries. It implemented
confirmed fixes in an isolated worktree. **This is a prioritized engineering
review, not a line-by-line approval of every PR or a production certification.**
Runtime reproductions and full local suites apply to the explicitly named
revision/candidate; source review and CI metadata have weaker evidence.

Baseline: `e509732e7cdd3277943b7a705a0fea9004ed0b7f` (main unchanged at the final
read). Branch: `fix/full-review-blockers-20261003`. Checkout:
`.worktrees/full-review-fixes-20261003`. The original dirty checkout is untouched.
Only one existing review agent was used, for mobile and independent review.

The initial snapshot had 41 PRs / 22 issues. A later read found **47 PRs / 29
issues** and refreshed ten existing heads. Original and refreshed metadata,
patches, and controlled reproductions live in
[the review evidence directory](../.reference/reviews/2026-10-03/README.md).
All dispositions below apply to the captured head; refresh before integration.

## Implemented locally

| Area                       | Before → after                                                                                                                                                                                                    | Evidence and applied seams                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Up Next                    | Manual order made later high-priority enqueue ineffective → enqueue normalizes priority/order transactionally; equal priority stays FIFO. Claimed rows are excluded from peek but retained in outstanding counts. | QueueService regressions, storage rollback injection, fixture UI enqueue and real terminal relaunch. Queue/dequeue/claim/restore and anime/TMDB-neutral storage semantics checked.                                                                            |
| Download dispatcher        | First 50 future-paused rows hid a due 51st job → due SQL filtering before page limit, deterministic keyset ordering and bounded claimed-row scan.                                                                 | Red on main, green on repaired service; useful due-selection design credited to #507. Existing corrupt-retry repair retained. Equal-timestamp cursor test added; competing-claim fixture timestamps now explicit instead of relying on incidental UUID order. |
| Playback watchdog          | `core-idle` cache starvation suspended clocks → only actual pause/idle-active suspends supervision.                                                                                                               | Injected-clock regressions for explicit paused=false/true; no test sleep.                                                                                                                                                                                     |
| Update/uninstall ownership | Startup swept neighbors/runtime backup; uninstall deleted foreign JSON → compiled-entrypoint gate plus exact binary aside, transaction schema/file identity checks and nonrecursive directory removal.            | Source/npm/compiled/platform-shaped fixtures; foreign JSON/text/dir regression is red on refreshed #540 and green locally. Explicit purge remains its separate contract.                                                                                      |
| Mobile terminal proof      | Interrupted backup recovery could discard recovery state; SIGINT lifetime ended too early → backup restoration before cleanup and AbortSignal through full session/HTTP/player/application ownership.             | Failure injection, emitted-artifact SIGINT integration, 138 mobile tests. This verifies host proof, not a physical phone.                                                                                                                                     |
| React lifecycle            | Digest dismissal timer outlived shell → owned timer cancelled on unmount. Docs derived browser/time state moved to stable SSR/client snapshots and explicit route clock.                                          | Docs tests, SSR/visibility/storage-denied/media-change coverage, actual production docs build. Browser/device visual checks remain.                                                                                                                           |
| Playback palette           | `LoadingShell` read command context above its provider → input reader is now a child of `ShellFrame`.                                                                                                             | #553 reproduced with per-keystroke input; ported source, four tests including Escape return and cancellable resolve, controlled timer delivery. Reconcile this port with later shell changes.                                                                 |
| CI/tooling                 | Cache included run logs; worktree output paths could cross; custom Bun cache was filtered by Turbo → cache only artifacts in checkout-local cache, declared docs build cache path and hash.                       | Installed-version Turbo docs, task graph, failing build then successful forced build. Verification tasks remain uncached. Restored the documented root AllManga crypto command, which forwards to the existing metadata-only CLI probe.                       |

Owning behavior docs were updated. The Oxfmt upgrade also normalizes a small
number of existing provider/relay/storage callbacks and Markdown tables; those
hunks are mechanical. A user-facing CLI patch changeset records the fixes.

## Remaining release gates, in order

1. **One coherent runtime candidate.** Reconcile the conflicting older rollup
   and newer stack. Preserve #500's unique connection pinning, #507's already
   repaired behavior, and these local fixes. Rebase onto current main and review
   the cumulative head; do not approve both stacks from independent green checks.
2. **Network trust closure.** Refreshed #540 at `4093fcfeea` still passes an
   original hostname to fetch after public DNS preflight, and resolver errors
   permit an unchecked request. Controlled tests fail for both cases without
   sending network traffic. Checked-IP connection, Host/TLS identity, proxy
   behavior, per-hop validation, bounded cancellation and fail-closed lookup
   must be one transport contract. #500 already supplies useful provider-gate
   work; the CLI remote fetch boundary also needs it. Audit nested manifests,
   redirects, user-selected versus upstream-controlled URLs and relay ports.
3. **Cleanup and persistence across the integrated head.** Port foreign-JSON
   and compiled-start ownership fixes onto #540; reconcile config serialization
   in #544 with consent/reverse states. A TERM immediately followed by KILL
   does not guarantee the process handled TERM or reaped descendants. A local Linux fixture ran the TERM-only handler, but the same installed handler never ran in ten adjacent TERM/KILL trials (all SIGKILL exits). This proves the claimed graceful ordering is insufficient; it does not by itself prove a real yt-dlp orphan on every platform. Verify
   actual process-tree teardown or a bounded asynchronous graceful exit.
4. **Fresh upstream provider evidence and publication.** The board's captured
   `generatedAt` is 2026-09-21, about 12 days old. The scheduled workflow's
   publication failed repeatedly on unstaged changes during rebase. Its eight
   probes do not cover all 12 main production adapters (13 in the newer stack),
   and semantic comparison drops timestamps even when a fresh observation
   occurred. Use a clean publication worktree with only the status artifact,
   controlled bot hooks and branch-aware retries; distinguish observation
   freshness from semantic changes. Derive/justify roster coverage against
   `loadProductionProviderModules`. Obtain region/title/direct/relay evidence
   rather than treating a publish failure as proof an upstream provider died.
   A fresh metadata-only AllManga bootstrap check here returns HTTP 200,
   diagnosis current, pinned build 177, pinned epoch 2960 / live epoch 2961.
   That validates this crypto bootstrap from this host, not episode resolution
   or actual video playback across every provider/region.
5. **Provider-independent offline continuity.** Existing
   [offline plan](offline-provider-independent-playback.md) owns retired-provider
   playback, selected artifact identity and no-network operation. Demonstrate
   an already downloaded movie and anime episode after disabling/removing their
   original provider; test missing optional artwork/subtitles separately.
6. **Fresh candidate qualification.** Forced source gates, exact host binary,
   isolated installer lifecycle and npm candidate; Windows/macOS parity,
   physical terminal protocols and actual provider/player journeys. Hosted doc
   coverage and optional Postgres/provider fixtures are separate gates. Root
   green alone does not certify these skipped or external paths.
7. **Trusted publication and support.** Resolve #529 with nine-package OIDC
   account evidence and candidate preservation. Verify disclosure/support and
   sponsorship destinations, documented support matrix, rollback/withdrawal
   procedure and redacted issue evidence before announcing production support.

The August merge-train board contains historical PR IDs and must be reconciled
against this live inventory before being used to drive merges. Its claims are
not evidence that the currently open runtime stacks are ready.

## CLI feature coverage and product priorities

| Journey                              | Current evidence                                                                             | Next improvement / proof                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Install → first playback             | Source/architecture gates, installer integration, compiled host and real local mpv fixture   | Exact npm/native candidate on supported OSs; current direct provider and real first-paint timing.                               |
| Search / discover / episode identity | Existing search/provider suites and captured stack changes                                   | Regional TMDB behavior, anime season ambiguity (#266), cold/warm latency and language/source fidelity.                          |
| Continue / Up Next / autoplay        | New queue regressions; compiled identity, claim, retry, shutdown-restore and loadfile smokes | Larger durable queues, competing processes, manual reorder while claimed, restart after crash and provider retirement.          |
| Download / offline library           | Due-job starvation fixed; persistence/ownership tests                                        | No-network restart with selected local artifact, paused/running recovery, bounded subprocess liveness and disk-budget behavior. |
| Palette / hotkeys / mouse / settings | Palette ownership fixed; existing conformance gates                                          | #547 query-response isolation, #552 actual click regions, advertised-action coverage, reverse settings and no dropped flags.    |
| Subtitles / autoskip / source picker | Existing resolver/player suites; source contract review                                      | Actual wrong/absent language, expiry/fallback, different provider catalogs and cancellation from every entrypoint.              |
| Share / presence / tracker sync      | Static contracts and existing fixture suites                                                 | Lawful/public-media share demo, recipient landing, redacted failures and actual opted-in account/provider signoff.              |
| Analytics / health / support         | Consent/privacy architecture gates; diagnostics source review                                | Latest-consent concurrent writes and disable signoff, provider health joined read model (#550); no new watch-history telemetry. |
| Mobile                               | Separate Node/a-Shell entrypoints, build separation, cancellation and recovery tests         | Physical device/player evidence, catalog/provider/history integration, distribution and explicit support policy.                |

**Highest-value public demo:** install, find a lawful/public test title, first
play, resume, queue the next episode, reopen offline, share the same title. Make
failure recovery visible and easy to report. Adoption depends on these journeys
being reliable. A mascot, social cards and viral wording cannot establish that.

**Sponsorship/support:** finish #523/#535's real support destinations and funding
configuration, document supported OS/terminal/player combinations and known
regional limitations, provide versioned redacted diagnostic exports and minimal
reproduction templates. Publish maintenance scope and response expectations
that can actually be met. Measure install success, first-play success and return
usage only with the established explicit consent contract, or gather opt-in user
interviews. Do not promise virality or best-in-class support without evidence.

**Maintainability alternative:** retain one domain/core/storage contract and
small runtime ports rather than moving the entire desktop container to phones.
Join existing health stores for support (#550); do not add another ledger.
Shrink large shell modules around input/async ownership as PRs already propose,
then ratchet architecture exceptions. Defer casting, plugins, cloud accounts
and wide UI rewrites until this foundation is qualified.

## Compatible upgrades and held migrations

| Package/tool                        | Local decision                         | Reason                                                                                                                                          |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Turbo                               | 2.11.5 → 2.11.7                        | Matched bundled docs; explicit worktree-local artifact cache and task environment.                                                              |
| Oxfmt                               | 0.59 → 0.71.0                          | Full formatter and check; retained mechanical hunks.                                                                                            |
| Next / Fumadocs                     | 16.3.8 / core+UI 16.15.18 / MDX 15.4.6 | Production docs build passes after fixing filtered cache env.                                                                                   |
| Motion / Recharts / shadcn          | 14.0.0 / 3.10.1 / 4.21.1               | Motion public React API remains compatible; installed, checked and built. Browser motion qualification remains.                                 |
| Neon / Node types / Bun types       | 1.2.0 / 26.6.4 / shared 1.4.2          | Compatible manifest/catalog cleanup.                                                                                                            |
| Bun / React / Ink / root TypeScript | Retained 1.4.2 / 19.3 / 7.1.1 / 7.0.2  | Already current stable when checked. No speculative framework replacement.                                                                      |
| Oxlint + plugin pair                | Retained 1.74                          | Attempted 1.86 exposes 38 existing CLI compiler/React findings. Stage that migration with actual fixes; do not disable correctness rules.       |
| Docs/relay TypeScript               | Retained 5.9.3                         | Next/Vercel tooling consumes compiler APIs unavailable in native TS7; do not upgrade by number alone.                                           |
| Changesets CLI/action               | Retained CLI 2.31.1 and action v1      | CLI3/action2 need coordinated inputs, empty-changeset and private-package semantics migration; release path is not an incidental patch upgrade. |

React Doctor 0.9.14 full CLI/docs scan (telemetry and supply-chain reporting off)
reported 15 errors / 181 warnings, with no numeric score. It misclassified the
CLI as Next due to the monorepo dependency. Treat each diagnostic as a lead,
inspect ownership/callees, and do not present all 196 as reproduced bugs. The
owned timer and docs snapshot changes were independently checked. Keep the
remaining ref/effect/input-ownership work as a staged React migration.
The final complete changed-scope comparison reports zero new errors and three
warnings: existing large AppRoot/LoadingShell functions and intentionally
sequential transaction-file inspection/removal. It is not a clean full-project
scan or a numeric health score.

**Fresh security audit:** `braces@3.0.3` is reported by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The advisory lists no patched release as checked on October 3. `bun pm why`
places it under development Changesets/shadcn tooling. No braces file appears
in the 20 generated docs server NFT traces; the CLI bundle scan also has no
braces/micromatch match. This narrows observed exposure, not a universal security
proof. The follow-up now carries a tracked Bun depth-limit patch based on
upstream PR 72 at `d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, with stringify's
pre-existing parent behavior retained. Fifteen checks failed on the unpatched
consumer paths and pass under Bun and Node after patched installation; a fresh
fixture frozen install also passes. Shared CI setup verifies installed behavior.
[Patch maintenance](../patches/README.md) records provenance and upstream removal
criteria. The registry audit still flags 3.0.3 and is not clean.

## Performance and CI

Seven local `--help` runs measured compiled median **92.59 ms** (max 184.65),
source median **120.40 ms** (max 141.00). Host binary: **80.6 MiB**, app graph
about **8,094 KiB**, most remaining bytes are embedded Bun. These are warm-process
help measurements with an isolated profile; they are not before/after speedups,
first TUI paint, phone measurements, or time-to-first-video.

Next measure p50/p95 first frame, first useful search result and first playable
frame with cold/warm stores and per-stage traces; record provider/region and
cancellation waste. #275/#274/#195 own startup/hedge/Miruro budgets. Use bounded
runtime-port I/O, latest-snapshot input handlers and owned subscriptions; avoid
speculative memoization or timeout inflation.

CI improvements implemented here keep only `.turbo/cache`, avoid restoring run
summaries as current evidence, isolate checkout-specific local output paths and
hash the Bun cache path needed by docs builds. Keep fresh blocking gates and
affected-task selection. Further gains: consolidate workspaces sharing exact
inputs, cache dependency downloads, make deployment previews docs-path selective,
and schedule expensive actual-provider/device suites outside every PR while
retaining a final release signoff. Measure runner minutes and queue duration
before promising a CI cost reduction. Vercel build-rate-limit failures are quota
evidence; fix real failing hosted jobs separately. Do not pay for a plan upgrade
merely to conceal code failures.

## Mobile availability and store submissions

**Current result:** a private terminal-host preview, not an APK/AAB/IPA or a
store-submittable native application. Android is Node in Termux with an external
player; iOS is an a-Shell JavaScriptCore host proof. Mock-host and Linux process
checks do not establish physical device startup, player acceptance, background
lifecycle, persistence, accessibility or end-to-end playback.

The user chose terminal-preview qualification first and has both Android and
an iPhone. PR #554 contains the cancellation/recovery repairs. Fresh host checks
pass (112 unit, 26 integration); all applicable hosted PR #554 checks including
CI ready also passed. Physical rows remain uncollected. The local
transfer kit binds artifacts to metadata and leaves every observation unpassed.
No phone was visible to ADB or the iPhone device tool during host inspection.

Fastest defensible route: qualify terminal preview on actual supported hosts and
publish truthful installation/support instructions after a candidate is approved.
For broader phone adoption, evaluate a small companion/public-media web or native
app using shared pure contracts and mobile-owned ports. Do not port desktop Bun,
Ink and mpv as one mobile runtime. Experimental Bun Android support exists; it
is not proof this chosen application graph runs correctly on a phone.

Planning estimates, not release commitments: terminal preview days after device
qualification and installer work; integrated desktop beta roughly 1–2 weeks after
runtime blockers and platform/provider signoff; a scoped native Android MVP
roughly 4–8 weeks and iOS 6–10+ weeks after agreeing lawful content and MVP scope.
The current code does not support an honest calendar submission date. A device
matrix, account access, signing, native player, background/foreground lifecycle,
privacy declarations, content permissions and review artifacts determine it.

As of this review, Apple submissions require Xcode 26 with iOS 26 SDK
([Apple requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a));
new Android apps/updates target API 36
([Android requirements](https://developer.android.com/google/play/requirements/target-sdk)).
New personal Google Play accounts can require 12 continuously opted-in testers
for 14 days before applying for production
([Play testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-en)).
These are submission gates, not app implementation estimates.

Resolve lawful provider/content scope before building a commercial store MVP.
Apple's self-contained execution, adequate-functionality and content-permission
rules and Play's intellectual-property rules matter to this app's streaming and
download behavior
([Apple guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Play IP policy](https://support.google.com/googleplay/android-developer/answer/9888072?hl=en)).
Store review duration is external and variable, so implementation completion is
not a guaranteed public launch date.

## PR disposition ledger

Every open PR in the refreshed inventory is listed. This table records scope and
next action; it does not confer merge approval. Original CI failures that disappeared
on refreshed heads are explicitly historical above. Captured full head/base OIDs,
files, bodies and checks are in the evidence directory.

| PR                                                    | Title                                                                                                     | Captured head | Disposition                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#553](https://github.com/KitsuneKode/kunai/pull/553) | fix(app-shell): let the playback command palette own the keyboard                                         | `c1caa4573d`  | Reproduced on main and ported locally. Four deterministic tests cover typed command keys, Escape restoration, and resolve cancellation. Port must be reconciled with the later shell stack.                                                                                                                                                                                                                         |
| [#545](https://github.com/KitsuneKode/kunai/pull/545) | fix(shell): legacy mouse strip, orphan-flag warnings, display-column widths                               | `1107103003`  | Hold: captured anti-slop gate rises +4 chained assertions, +2 runtime typeof, +9 missing safety comments; fix the sites and rerun rather than increasing the baseline. Seventy changed files exceed the narrow title; inspect cumulative action targeting and key routing, not just width helpers.                                                                                                                  |
| [#544](https://github.com/KitsuneKode/kunai/pull/544) | fix: lifecycle lows — wedged downloads, orphan-safe kills, socket sweep, config write ordering            | `dfac31be4b`  | Config serialization and stale-socket cleanup are useful. Check bounded idle timers with injected clocks. Back-to-back TERM/KILL is not a child-reaping guarantee; retain a graceful wait or verified process-tree teardown. Captured Windows failure asserts POSIX dead-socket removal; docs gate fails unchanged lastReviewed fields. These are code/test/documentation gates, separate from Vercel quota limits. |
| [#543](https://github.com/KitsuneKode/kunai/pull/543) | fix(security): close credential-leak and target-vetting gaps in playback plumbing                         | `1d4ce5202a`  | Review before release: header/token arguments move to a private mpv include file; test actual ACLs, readiness cleanup, crash recovery, and all player entrypoints. DNS checks need connection pinning. Manifest literal checks do not establish safety for nested DNS-controlled requests.                                                                                                                          |
| [#542](https://github.com/KitsuneKode/kunai/pull/542) | fix(mobile): harden the host-proof preview runtime                                                        | `c742199bca`  | Useful mobile host-proof hardening; reconcile with local backup/cancellation fixes. Range only bounds transfer when the origin honors it. Keep actual device and player acceptance evidence separate from mock-JSC proof.                                                                                                                                                                                           |
| [#541](https://github.com/KitsuneKode/kunai/pull/541) | fix(providers): typed failure classification + stable dead-stream keys                                    | `027a89391c`  | Preserve typed throttle/block/unavailable classifications and stable deferred-stream content keys. Follow field declaration through adapters, dead-stream writes, and candidate filtering; do not treat fresh locators as stable identities.                                                                                                                                                                        |
| [#540](https://github.com/KitsuneKode/kunai/pull/540) | fix(update): stop destructive paths from touching foreign files and crashing                              | `4093fcfeea`  | Repair required: foreign notes.json is still deleted at refreshed head 4093fcfeea. Local schema/identity + rmdir fix is stronger. Source/npm startup also needs the compiled-entrypoint gate implemented locally.                                                                                                                                                                                                   |
| [#539](https://github.com/KitsuneKode/kunai/pull/539) | fix(net): bound provider network trust boundaries — DNS, bodies, redirects, fan-out                       | `f4456ebf65`  | Repair required: at refreshed cumulative head 4093fcfeea, DNS preflight still fetches the hostname again and DNS errors permit a fetch. Two controlled reproductions remain red. Keep the connection-pinning work from #500 when integrating.                                                                                                                                                                       |
| [#538](https://github.com/KitsuneKode/kunai/pull/538) | perf(docs): load search on demand and fix the dead code-comment contrast rule                             | `6394f4ff2e`  | Lazy search and contrast selector are useful. Earlier lint/doc-path failures belong to earlier heads; refreshed checks no longer show those failures. Validate current cumulative build and keyboard/search behavior. Vercel rate limits are separate.                                                                                                                                                              |
| [#537](https://github.com/KitsuneKode/kunai/pull/537) | feat(docs): redesign the home sections, add the workshop, and shrink the nav on scroll                    | `356792b5b7`  | Keep home/workshop/navigation as a docs track after runtime readiness. Verify reduced motion, narrow viewport, sticky-nav scroll, and link destinations on the refreshed head.                                                                                                                                                                                                                                      |
| [#536](https://github.com/KitsuneKode/kunai/pull/536) | feat(docs): per-page social cards, richer JSON-LD and a truthful sitemap lastmod                          | `6b6414dcab`  | Validate generated social cards, canonical URLs, sitemap timestamps, and content identity at the current head; avoid inventing lastmod dates for unchanged content.                                                                                                                                                                                                                                                 |
| [#535](https://github.com/KitsuneKode/kunai/pull/535) | feat(docs): home polish, /support, a real type scale and calmer docs chrome                               | `0dfc28ba9d`  | Support/funding and typography are useful. The old support test-path finding is historical; refreshed checks are green. Confirm actual sponsor/account links and mobile/reduced-motion support surfaces before deployment.                                                                                                                                                                                          |
| [#534](https://github.com/KitsuneKode/kunai/pull/534) | feat(docs): Kanna walks, with a stride that follows distance and a heading lean                           | `ba1b62c18b`  | Keep the character optional and fully dismissible. Reconcile visibility-store changes with this motion branch; test reduced motion, coarse pointers, storage denial, and unmount cleanup in the browser.                                                                                                                                                                                                            |
| [#533](https://github.com/KitsuneKode/kunai/pull/533) | feat(docs): analytics sparklines, release markers and a 7-day average                                     | `444a049db0`  | Analytics charts need stable time inputs, accessible tabular fallback, empty/partial history behavior, and server/client hydration checks. Reconcile LocalTime/UsagePanel/TrendTable fixes implemented locally.                                                                                                                                                                                                     |
| [#532](https://github.com/KitsuneKode/kunai/pull/532) | feat(design): refine Ember Dusk contrast and separate crowded hues                                        | `8f17f0e2f6`  | Contrast work is useful. The earlier Windows AniSkip failure is historical after the refreshed green head; still capture rendered contrast and parity on the final integrated candidate.                                                                                                                                                                                                                            |
| [#531](https://github.com/KitsuneKode/kunai/pull/531) | chore: remove dead modules and strip banner headers                                                       | `9ddd7daaf2`  | Deletion-only cleanup: trace runtime callers, build-generated references and docs before removing modules. Run architecture, build and doc gates on the rebased candidate.                                                                                                                                                                                                                                          |
| [#530](https://github.com/KitsuneKode/kunai/pull/530) | fix(design): readable secondary text, reduced-motion spinner, reproducible UI demo                        | `7a6cccd7f1`  | Useful accessibility work; inspect actual dark/light rendered text and narrow terminal layouts. Keep unrelated UI redesign outside this contrast fix.                                                                                                                                                                                                                                                               |
| [#528](https://github.com/KitsuneKode/kunai/pull/528) | fix(ux): make overlay/palette actions act on the item the user chose                                      | `4d36ee2926`  | Refreshed head changes 100 files. Audit exact selected-item identity from mouse/palette/hotkey through actions, both anime and TMDB lanes, cancellation and focus restoration. Require cumulative integration gates.                                                                                                                                                                                                |
| [#527](https://github.com/KitsuneKode/kunai/pull/527) | fix(ux): make advertised keys match real handlers                                                         | `46d5eba5d7`  | Preserve truthful key hints and live readers; verify each advertised key on the surface that owns it. Reconcile with #553 and #545 rather than layering another handler.                                                                                                                                                                                                                                            |
| [#526](https://github.com/KitsuneKode/kunai/pull/526) | fix(reliability): contain playback callbacks and wake download retries                                    | `e0dedab852`  | Reliability tranche: assess cumulative timeout/recovery contracts and reverse states; retain only source-confirmed fixes after rebase.                                                                                                                                                                                                                                                                              |
| [#525](https://github.com/KitsuneKode/kunai/pull/525) | fix(security): harden the provider→local trust boundary                                                   | `f1c062b429`  | Trust boundaries: preserve explicit analytics consent, safe installer defaults, metadata-only relay and user-owned hosts. Avoid restoring old findings already fixed in current #507.                                                                                                                                                                                                                               |
| [#523](https://github.com/KitsuneKode/kunai/pull/523) | chore: security/community scaffolding, SHA-pinned actions, dependency monitoring                          | `3080b1e8de`  | Security/community scaffolding helps support and sponsorship. Confirm real disclosure destination, maintained ownership, contribution commands and sponsorship links before advertising them.                                                                                                                                                                                                                       |
| [#522](https://github.com/KitsuneKode/kunai/pull/522) | fix(player): external SIGKILL ≠ quit · honest playback_events finale · agent:session --fake-mpv-mode      | `61446431fc`  | Preserve honest playback-exit reasons. A failed handoff must not become completed history; verify real process exit and durable evidence.                                                                                                                                                                                                                                                                           |
| [#521](https://github.com/KitsuneKode/kunai/pull/521) | feat(app-shell): SGR mouse input foundation — proxy stdin + hit regions                                   | `550f00c61c`  | Mouse foundation is useful; pending #552 owns region coverage. Wheel fallback does not prove click activation; verify advertised actions and actual hit targets.                                                                                                                                                                                                                                                    |
| [#520](https://github.com/KitsuneKode/kunai/pull/520) | fix(player): mpv crash never reads as a completed watch                                                   | `74ad599e43`  | High-priority player crash work. Require the exact compiled host artifact, shutdown return-to-shell, bounded recovery and no false completed-history writes.                                                                                                                                                                                                                                                        |
| [#519](https://github.com/KitsuneKode/kunai/pull/519) | refactor(app-shell): extract useBrowseOverlay — details overlay cluster                                   | `0866e105dc`  | Overlay focus/selection work belongs with keyboard ownership; preserve selected row and close/reopen semantics across playback transitions.                                                                                                                                                                                                                                                                         |
| [#517](https://github.com/KitsuneKode/kunai/pull/517) | refactor(app-shell): extract useResultNarrow — narrow/badges/Esc-layer cluster                            | `8f78f3fdcb`  | Narrowing is helpful only when every runtime producer conforms; avoid assertions that hide a genuinely missing/error result.                                                                                                                                                                                                                                                                                        |
| [#516](https://github.com/KitsuneKode/kunai/pull/516) | fix(diagnostics): map provider failure classes honestly at the boundary                                   | `af0f7e4880`  | Diagnostics should redact tokens/URLs and join existing evidence. #550 owns the remaining unified read model; do not add a competing health store.                                                                                                                                                                                                                                                                  |
| [#515](https://github.com/KitsuneKode/kunai/pull/515) | refactor(app-shell): extract useIdleSurface — idle surface state + navigation                             | `a1618811ad`  | Browse idle improvements need measured render/CPU evidence; keep active input and async refresh responsive. Do not equate fewer effects with faster interaction.                                                                                                                                                                                                                                                    |
| [#513](https://github.com/KitsuneKode/kunai/pull/513) | refactor(app-shell): useCommandPalette — shared palette state + key choreography                          | `a768905521`  | Command-palette extraction is useful; verify availability, selected-item targeting, focus return and handler ownership. #553 proves a provider-placement gap remains on main.                                                                                                                                                                                                                                       |
| [#511](https://github.com/KitsuneKode/kunai/pull/511) | feat(relay): validate the RPC envelope against @kunai/schemas at both ends                                | `78447f0c97`  | Relay remains metadata-only, direct media URLs and empty user-owned default URL. Run transport-schema and SSRF/pinned-DNS gates before integration.                                                                                                                                                                                                                                                                 |
| [#510](https://github.com/KitsuneKode/kunai/pull/510) | feat(providers): ProviderQueryCache — keyed async-cache primitive + 5 migrations                          | `a92ddf49d4`  | Cache work needs invalidation, TTL, cancellation and identity tests. Compare cold/warm timings and memory; a green cache hit is not fresh verification.                                                                                                                                                                                                                                                             |
| [#509](https://github.com/KitsuneKode/kunai/pull/509) | feat(providers): unified endpoint resilience + Retry-After honoring                                       | `20000c01c4`  | Typed provider health should keep cancelled/not-found evidence neutral and honor Retry-After. Check #267 against exact Rivestream classification, not only generic helpers.                                                                                                                                                                                                                                         |
| [#508](https://github.com/KitsuneKode/kunai/pull/508) | feat(providers): reliability overhaul — honest failure taxonomy, shared transport, AnimeKai               | `e1f9d00303`  | Base of the newer runtime stack is conflicting and changes-requested. Rebase once onto current main, preserve unique older fixes, then verify the cumulative candidate; current children are not blanket merge approvals.                                                                                                                                                                                           |
| [#507](https://github.com/KitsuneKode/kunai/pull/507) | Close the CLI trust gaps that were still lying                                                            | `5eb6090522`  | Large conflicting trust-boundary rollup. Latest head already fixes several old audit claims, including signed PowerShell verification and due-download selection. Salvage unique fixes; do not merge both overlapping stacks wholesale.                                                                                                                                                                             |
| [#506](https://github.com/KitsuneKode/kunai/pull/506) | chore(repo): hygiene gates — failure classifiers, cache bounds, relay token, contract tests               | `ba9b83cfd6`  | Repository hygiene belongs after runtime reconciliation. Retain current routing and fresh verification gates; do not delete unfinished plans because an older audit marked them complete.                                                                                                                                                                                                                           |
| [#505](https://github.com/KitsuneKode/kunai/pull/505) | fix(cli): focus-aware input ownership and press-again destructive confirms                                | `8f4f5adf9e`  | Older shell tranche: compare with newer selected-item/focus work and salvage unique changes only. Re-test route/hotkey/post-play seams after integration.                                                                                                                                                                                                                                                           |
| [#504](https://github.com/KitsuneKode/kunai/pull/504) | feat(cli): watched-download cleanup review, OS notifications, retire dead settings                        | `3a46430226`  | Older shell tranche with broad scope; compare cumulative deltas against newer stack before retargeting. Preserve current navigation and identity behavior.                                                                                                                                                                                                                                                          |
| [#503](https://github.com/KitsuneKode/kunai/pull/503) | fix(cli): honest shell UX — details-card overlap, doctor writability probe, catalog failure messages      | `e11cc39f07`  | Older shell tranche: extraction is not user-path proof. Compare against newer palette/overlay implementation before integration.                                                                                                                                                                                                                                                                                    |
| [#502](https://github.com/KitsuneKode/kunai/pull/502) | fix(relay,providers): one production roster, honest relay refusals                                        | `218c5e9dc9`  | Relay/production roster coverage: derive decisions from loadProductionProviderModules and preserve metadata-only authority; module existence is not a live-provider claim.                                                                                                                                                                                                                                          |
| [#501](https://github.com/KitsuneKode/kunai/pull/501) | fix(cli): honor --offline, stop cross-window config clobbering, survive malformed config                  | `a8adea285e`  | Config-integrity base is conflicting and changes-requested. Reconcile config write ordering and latest consent at the persistence boundary; do not overwrite concurrent dirty work.                                                                                                                                                                                                                                 |
| [#500](https://github.com/KitsuneKode/kunai/pull/500) | fix(providers): gate movy, hianime, kickassanime, and animegg                                             | `e5fd018af3`  | Important unique stream-gate work: DNS addresses checked during validation must be the addresses used for connection, preserving Host/TLS serverName and denying resolver failures. Retain this while integrating #539; test local and relay runtime ports independently.                                                                                                                                           |
| [#499](https://github.com/KitsuneKode/kunai/pull/499) | docs: document the mobile capability preview honestly                                                     | `f00a5bf29e`  | Mobile honesty docs are useful; reconcile with current terminal-preview state and avoid representing a host proof as a store-ready native app.                                                                                                                                                                                                                                                                      |
| [#327](https://github.com/KitsuneKode/kunai/pull/327) | chore: version packages                                                                                   | `a0247bf658`  | Hold version bump until the integrated candidate passes release gates. Version/changelog alignment cannot establish playback, provider or store readiness.                                                                                                                                                                                                                                                          |
| [#306](https://github.com/KitsuneKode/kunai/pull/306) | Chromecast audo video                                                                                     | `c1742a1aa5`  | Conflicting, changes-requested casting feature; defer until desktop/phone playback is stable and a real LAN receiver is qualified. Salvage unique code only after the core candidate is settled.                                                                                                                                                                                                                    |
| [#287](https://github.com/KitsuneKode/kunai/pull/287) | feat: add Android Termux player handoff preview                                                           | `b2ab0c90d6`  | Draft conflicting terminal-mobile branch overlaps already landed main foundations. Salvage unique work after current host-proof decisions; do not reintroduce desktop Bun/Ink/mpv dependencies into mobile.                                                                                                                                                                                                         |
| [#255](https://github.com/KitsuneKode/kunai/pull/255) | refactor: clear anti-slop chained assertions from src and make the rule blocking [hold until after 0.3.0] | `46cb267e25`  | Conflicting post-0.3.0 lint cleanup. Keep ratchet gates, defer broad debt churn until runtime fixes are integrated; do not raise baseline to make a failing change pass.                                                                                                                                                                                                                                            |

## Issue disposition ledger

No issue was closed or edited. Candidates for closure require exact current
source/test evidence and a later authorized tracker action.

| Issue                                                   | Title                                                                                                      | Current action                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#552](https://github.com/KitsuneKode/kunai/issues/552) | Mouse coverage pass: hit regions on remaining interactive surfaces                                         | Remaining mouse hit-region coverage. Define action parity per surface; clicks, drag and modifiers require actual rendered-target proof.                                                                           |
| [#551](https://github.com/KitsuneKode/kunai/issues/551) | Expand fake-mpv modes for the verify harness                                                               | Expand deterministic fake-player modes for no-progress/slow IPC/conf parse/stale sockets, each paired with playback event or diagnostic evidence. Keep real-mpv tier.                                             |
| [#550](https://github.com/KitsuneKode/kunai/issues/550) | Consolidate stream-health evidence: failure ledger, endpoint health, and resolve trace                     | Build a joined health read model from failure ledger, endpoint health and last resolve trace. Consumer is diagnostics/shell; do not create another store.                                                         |
| [#549](https://github.com/KitsuneKode/kunai/issues/549) | Episode selector flag: -e/--episode to jump straight to an episode                                         | Episode selector is a designed feature, not a parser-only flag. Decide orphan behavior, 1-based numbering, source ambiguity, resume and both identity lanes before implementation.                                |
| [#548](https://github.com/KitsuneKode/kunai/issues/548) | Headless resolve surface: non-interactive --resolve with --json output                                     | Version a headless resolve result and redaction policy. Reuse the real resolve service with bounded cancellation, no silent Ink/player mount or unexpected profile migration.                                     |
| [#547](https://github.com/KitsuneKode/kunai/issues/547) | Isolate the terminal query/response channel from user input on stdin                                       | Terminal query replies and user input need a shared demultiplexer; reproduce probe swallowing and late DA/kitty/CPR response leakage. Preserve typed bytes across probe completion.                               |
| [#546](https://github.com/KitsuneKode/kunai/issues/546) | Terminal capability layer for unicode glyphs — fallback set for non-unicode terminals                      | Add a small capability/glyph abstraction with explicit ASCII override, then migrate gradually. Locale/TERM are heuristics; do not promise screen-reader support without a defined output channel.                 |
| [#529](https://github.com/KitsuneKode/kunai/issues/529) | docs(release): write the trusted-publishing preflight section properly                                     | Trusted-publishing preflight still needs documentation and account evidence for all nine packages. Verify npm trust casing, confirmation, and actual OIDC configuration; no registry mutation is authorized here. |
| [#480](https://github.com/KitsuneKode/kunai/issues/480) | TMDB unreachable under ISP-level DNS interference — add DoH or relay fallback                              | Regional TMDB interference requires a live affected-network trace. Prefer user-owned metadata relay; evaluate opt-in verified DoH/TLS pinning next. Keep shared relay URL empty.                                  |
| [#472](https://github.com/KitsuneKode/kunai/issues/472) | ci: lint:anti-slop is 5,427 errors on main and is neither gated nor baselined                              | Issue language predates the current anti-slop baseline gate. Reconcile current baseline/changed-file ratchet; broad lint debt remains, so close only the superseded claim with evidence.                          |
| [#432](https://github.com/KitsuneKode/kunai/issues/432) | test flakes: ordering-gate sleeps and elapsed-bound assertions still time-coupled                          | Ordering-gate sleeps partially improved; finish deterministic barriers/clocks. PR553 local tests now deliver pending Escape callbacks without real sleeps.                                                        |
| [#422](https://github.com/KitsuneKode/kunai/issues/422) | tracking: upstream provider outages (2026-09-21) — videasy, anidb, allanime, miruro stream host            | Provider outage report is historical. Obtain fresh title/region/network proof; the published status board is stale, so its current timestamp is not an uptime claim.                                              |
| [#343](https://github.com/KitsuneKode/kunai/issues/343) | Docs: replace stale ESLint wording with Oxlint contributor commands                                        | Candidate for closure: current docs use Oxlint rather than the obsolete ESLint instruction. Verify exact current wording before a future authorized close.                                                        |
| [#342](https://github.com/KitsuneKode/kunai/issues/342) | Docs: align quickstart Bun prerequisite with package minimum                                               | Candidate for closure: current quickstart and package engines require Bun 1.4.2. Do not downgrade that requirement during upgrades.                                                                               |
| [#319](https://github.com/KitsuneKode/kunai/issues/319) | Test suite is flaky because timing assertions race the parallel runner                                     | Track test-global contamination and environment-specific failures. Bun --isolate disproved four mock-leak failures; final default graph passed with local loopback enabled. Keep Windows evidence separate.       |
| [#278](https://github.com/KitsuneKode/kunai/issues/278) | Guard against a changeset landing on an already-staged, unpublished version (third recurrence)             | Candidate for closure: staged changeset guard exists in scripts/release-guard.ts. Run guard and check the staged-diff path rather than adding a duplicate guard.                                                  |
| [#275](https://github.com/KitsuneKode/kunai/issues/275) | First paint waits on probing, container creation, and analytics init — profile it                          | Measure first TUI paint (cold/warm, p50/p95, vault/probe work) before startup restructuring. The measurements in this review are --help process lifetime, not first paint.                                        |
| [#274](https://github.com/KitsuneKode/kunai/issues/274) | Measure before changing the 5s provider hedge: cycle sources within a provider first?                      | Measure slow-tail resolve traces per provider/region before changing hedge delay. Bound waste and cancellation; a lower constant is not proof of a faster playable stream.                                        |
| [#267](https://github.com/KitsuneKode/kunai/issues/267) | providers: Rivestream feeds no endpoint health, and 'not-found' must never be treated as an unhealthy host | Rivestream failure classification needs exact adapter tests for not-found and endpoint outage. Generic neutral helpers alone do not close the issue; #509/#541 are relevant.                                      |
| [#266](https://github.com/KitsuneKode/kunai/issues/266) | anime identity: season ordinals cannot be resolved from a title string, and every provider re-guesses them | Anime season ordinals remain ambiguous across catalogs. Preserve external identity and absolute 1-based episode presentation; follow the existing anime identity plan.                                            |
| [#195](https://github.com/KitsuneKode/kunai/issues/195) | Miruro resolve is ~10s on the success path, with no per-stage trace                                        | Miruro stage budgets need real per-stage timings on the affected region. Do not increase one global timeout and call the outage fixed.                                                                            |
| [#192](https://github.com/KitsuneKode/kunai/issues/192) | Cancelled resolves write negative provider health                                                          | Candidate for closure: current isProviderHealthNeutral handles cancelled resolves. Verify all writers and adapter paths before a future authorized close.                                                         |
| [#121](https://github.com/KitsuneKode/kunai/issues/121) | Package-manager installs cannot self-update: verify the notify path end to end                             | npm update notification is a different channel from native self-replace. Verify installed package manager and registry version end to end; no live installation was changed here.                                 |
| [#113](https://github.com/KitsuneKode/kunai/issues/113) | Type collisions: EpisodeInfo means two things; SubtitleTrack vs SubtitleEntry                              | DTO naming/consolidation is maintenance debt after runtime stability. Pick canonical owners and ratchet migration; avoid broad renaming with competing PRs.                                                       |
| [#112](https://github.com/KitsuneKode/kunai/issues/112) | Container is 91 members with 30 unsafe test casts — add createMockContainer                                | Reduce container/test doubles to typed ports; preserve existing 91-member wiring. Narrow fixtures where justified rather than blanket unknown assertions.                                                         |
| [#111](https://github.com/KitsuneKode/kunai/issues/111) | Layering allowlist: document the ratchet, then burn it down opportunistically                              | Boundary allowlist already exists. Freeze/ratchet exceptions and shrink when touching callers; do not move whole layers merely to improve a diagram.                                                              |
| [#110](https://github.com/KitsuneKode/kunai/issues/110) | Large-module inventory: app-shell is the real concentration, not PlaybackPhase                             | Large shell extraction is underway in #513/#515/#517/#519. Verify focus, async ownership and route seams before claiming the split fixes behavior.                                                                |
| [#109](https://github.com/KitsuneKode/kunai/issues/109) | Flat root modules in apps/cli/src bypass the layering gate                                                 | Extend architecture coverage to mapped root entrypoints/imports. Existing layering gate is valuable but does not cover every root file.                                                                           |
| [#106](https://github.com/KitsuneKode/kunai/issues/106) | crypto-js removal is an EVP_BytesToKey reimplementation, not a swap                                        | Candidate for closure: crypto-js is removed and native EVP parity tests exist. Verify imports, lockfile and all relevant provider paths before closing.                                                           |

## Verification receipts and boundaries

See [verification receipts](../.reference/reviews/2026-10-03/verification.md).
All execution used temporary HOME/XDG/APPDATA roots, not KUNAI_CONFIG_DIR.
Analytics stayed declined; fixture evidence has an empty installId.
No registry trust, OAuth, production provider, live analytics account, publishing,
GitHub tracker state or deployment was changed.

Root tests passing establish the local repair candidate. They do not establish
the readiness of any unmerged cumulative PR head, real physical mobile device,
actual provider network, hosted Postgres, all native installers or app store.
