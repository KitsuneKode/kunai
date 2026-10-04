# PR quality review — 2026-10-04

This is a revision-bound review, not approval of every open PR. The original dirty checkout was preserved. Main was `e509732e7cdd3277943b7a705a0fea9004ed0b7f`; the repair baseline was #563 at `74c1697a4765ddd7c3b3df6411f8d9e74c14e5c1`.

## Scope and evidence

The live inventory contained **57 open PRs and 28 open issues**. Metadata was refreshed for all PRs; review decisions and all review threads were fetched for the 18 PRs below (none had another page of threads). Source review concentrated on the current runtime repair stack, #545/#508's outstanding findings, the recent design/docs work, CI and review automation. Two focused reviewers assessed #562's immutable head `20fa74725726ec0d4649b7dc280efa4e3a183a32` against `7f59aedd62b72d39a93b5d62888df9e2a4985681`, under separate standards and specification passes. Agreement between reviewers is not independent runtime evidence.

The detailed receipts are local snapshots; branch names and mergeability can change. Refresh both head and base before integration. Hosted #563 CI run [37202999057](https://github.com/KitsuneKode/kunai/actions/runs/37202999057) succeeded at its exact head, including Windows/macOS and native installer scenarios. It does not qualify the next repair head.

## Standards findings

- **Shutdown duration retention:** after duration=2000, progress=400, duration=null and progress=401, the earlier fallback loses duration because it depends on the latest progress sample. The result falsely accepts a premature network EOF. Reading the IPC router and the immediate-clear test ruled out a missing event path: the intervening progress event is the uncovered case. A per-cycle positive duration observation repairs it; cycle construction resets this state.
- **Continue preparation:** an already validated downloaded Continue selection still enters provider lookup and cold remote enrichment before choosing local playback. The real-container fixture previously recorded one registry lookup and four network calls. The dedicated offline-library path already avoided these; Continue was the incomplete path. Preparation now consults the same source policy for a known episode/movie and preserves the explicit streaming preference.

## Specification findings

- **Selected anime artifact identity:** projecting a selected download into playback drops its provider-native episode identity, and initial auto-entry drops it again. With two local artifacts sharing numeric season/episode, playback can choose the other catalog identity. The regression seeds a newer conflicting artifact and selects the original job. Both projections now retain identity.
- **Initial episode resume:** auto-entry uses the latest title history's position even when it belongs to another episode. A downloaded E2 can start at E1's saved 90 seconds. The next-episode resolver already checks target history; initial entry bypassed it. Auto-entry now checks the selected season/episode and retains the downloaded anime season. Same-episode resume remains a separate positive control.

These are incomplete repairs/inherited behavior; this review does not claim every defect was introduced by #562. Five initial regression cases failed before the fixes. Restoring the old auto-entry helper also failed four additional resume/season cases. Focused checks after the initial fixes passed 59 tests; final controls are included in the candidate. Fresh full checks: **8,151 passed / 60 skipped / zero failures; 26 successful tasks, zero cache replays**. Typecheck: 15 fresh tasks. Lint: 14 fresh tasks, zero errors and 20 existing warnings. CLI/host binary build: ten fresh tasks. Agent tier: 24 passed, one opt-in real-mpv skip, zero failures. Documentation paths/frontmatter and the anti-slop ratchet passed. An initial sandbox-only full run failed on loopback `listen EPERM`; the permitted loopback-fixture run produced these passing receipts. No timeout was raised to hide a test failure.

## Existing review threads: fix versus stale feedback

- [#545 download-path warning](https://github.com/KitsuneKode/kunai/pull/545#discussion_r4172520789): still present by source inspection at `3243c0c139a2f2a71ae6062d13fe8073338a05f9`. Bootstrap warns before a pending share download later sets `args.download`; the warning does not reflect the effective intent. This pass did not execute a complete share bootstrap fixture or repair that branch.
- [#545 Miruro malformed catalog response](https://github.com/KitsuneKode/kunai/pull/545#discussion_r4172795682): repaired in the current source. Endpoint response contracts run before health success, and malformed-response tests exist. The review decision was recorded against an older commit. Request a current-head review before resolving the thread; those branch tests were not executed in this pass.
- [#508 HiAnime quality/source pin](https://github.com/KitsuneKode/kunai/pull/508#discussion_r4160912167): still present by source inspection at `e1f9d003033148ca68203a1a8367c2c9c3fe297d`. Shared lane identity is passed as an explicit source preference to startup selection, where first-match selection precedes quality ranking. This is a branch-specific finding, not a live-provider playback claim.
- [#508 relay error ownership](https://github.com/KitsuneKode/kunai/pull/508#discussion_r4160912176): reproduced at the same head by importing a `git archive` snapshot of the exact types module. A primitive rejection remains unmarked; a frozen Error throws an unmarked TypeError; an extensible Error is marked successfully. The transport fallback relies on that marker. Read both relay catch and the downstream fallback condition; no configured transport end-to-end fixture was executed here. This helper is absent from the #563 release-candidate lineage, so it is not reported as a current-candidate relay regression.

#508 and #507 were conflicting against main. #500 and #545 had change-request decisions against older commits. Zero threads or a stale decision is neither approval nor a current-head failure verdict.

## Review and merge enforcement

The branch-protection API returned `Branch not protected` for main. Its only returned ruleset (`20812901`, `rules`) was disabled. No settings were changed.

The #563 CodeRabbit comment explicitly skipped review because its base is not the default branch. Its configuration has root-level `tools`, rejected by the bot schema. PR #561 repairs nesting and enables stacked base branches, but remains unmerged and its configuration is not present in #563. Authored `docs/**` are also excluded from bot review. Consider explicit author-approval override protection and authored-doc coverage rather than treating an empty review list as signoff.

Primary references: [CodeRabbit configuration](https://docs.coderabbit.ai/reference/configuration), [automatic review scope](https://docs.coderabbit.ai/configuration/auto-review), [request-changes exceptions](https://docs.coderabbit.ai/pr-reviews/request-changes-workflow), [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches). Explicit bot approve/resolve commands can bypass its ordinary latest-review checks. No such commands were posted and no threads were blanket-resolved.

## Current CI failures and stale provider publication

Current-head check rollups succeeded for #563, #562, #561, #560, #559, #558, #557, #556, #554, #553, #545, #507 and #500. This includes path-aware skipped jobs and CodeRabbit success statuses that can mean review skipped; it is not approval of source correctness.

- #544: Windows CLI parity failed `sweep unlinks a dead socket and its conf, keeps a live pair` at `mpv-ipc-endpoint.test.ts:116`. Docs build and the aggregate also failed. [Windows failure](https://github.com/KitsuneKode/kunai/actions/runs/37078387725/job/111073321365).
- #543: Docs build failed because three changed docs retained their old `lastReviewed` value. [Docs failure](https://github.com/KitsuneKode/kunai/actions/runs/37077535456/job/111070684548). Reconcile the actual documents, not a freshness bypass.
- #508: current-head Windows parity and `CI ready` failed. The failed job log was not inspected in this pass, so no new cause is asserted.
- #539/#540 and some older #543/#544 Vercel checks link to a build-rate-limit error. This is preview infrastructure evidence, not a source regression. Their GitHub check conclusions must be assessed separately.
- Today's scheduled provider sweep [37202441266](https://github.com/KitsuneKode/kunai/actions/runs/37202441266) failed publication with `cannot rebase: You have unstaged changes` on all three attempts. #557's clean-worktree repair remains unmerged. The main board cannot be treated as fresh evidence until publication succeeds; a failed publisher is not proof a provider is down.

## CI, product and platform limits

- CI has an aggregate `CI ready` job, path-aware jobs, fresh dependency-patch verification, Windows/macOS tests, docs coverage, Postgres and native installer scenarios. Branch enforcement must require the aggregate and version/changelog gate on current commits. A merge queue would additionally need a `merge_group` trigger; its absence is not a defect while no merge queue is enabled.
- Real-mpv agent CI is push-only. A release candidate needs that evidence plus a real install-to-play journey. One successful run is not a cold/warm CI performance benchmark. Measure setup and critical-path task duration before changing cache or concurrency policy.
- #559 contrast/status and #560 analytics source changes were inspected, without a confirmed source defect. Actual terminal/browser pointer, keyboard, touch and accessibility qualification remain distinct from their source/unit tests.
- A fresh metadata-only AllManga crypto probe returned HTTP 200, diagnosis `current`, pinned build 177, pinned epoch 2960 and live epoch 2961. This checks the bootstrap contract from this host; it does not qualify episode/video playback or phone header parity. The production registry in this candidate contains 12 adapters; the static provider matrix lists seven rows (AllManga uses the `allanime` alias), so the matrix's “every production provider” description is not complete roster coverage. The scheduled status sweep separately lists eight adapters; both need explicit coverage decisions for vidrock, movy, animegg and kickassanime, and the matrix also omits HiAnime.
- Network request destination binding, destructive lifecycle/process-tree cleanup, current regional provider evidence and trusted publishing account proof remain in the prior production review. They must be reconciled on the integrated candidate, not declared closed by this offline patch.
- Mobile is still a terminal-host preview. The prepared test kit is not APK/AAB/IPA and neither physical phone has supplied qualification evidence. A bundled local touch companion is a promising next slice, not an implemented phone release.

## Detailed review snapshot

| PR | Head | Base | Mergeability | Review decision | Open threads |
| --- | --- | --- | --- | --- | --- |
| [#563](https://github.com/KitsuneKode/kunai/pull/563) | `74c1697a4765` | `fix/offline-provider-authority-20261003` | MERGEABLE | none | 0 |
| [#562](https://github.com/KitsuneKode/kunai/pull/562) | `20fa74725726` | `fix/queue-view-states-20261003` | MERGEABLE | none | 0 |
| [#561](https://github.com/KitsuneKode/kunai/pull/561) | `4f441109886f` | `fix/full-review-blockers-20261003` | MERGEABLE | none | 0 |
| [#560](https://github.com/KitsuneKode/kunai/pull/560) | `132658b4b461` | `docs/perf-lazy-search` | MERGEABLE | none | 0 |
| [#559](https://github.com/KitsuneKode/kunai/pull/559) | `875704e62660` | `fix/text-contrast-and-reduced-motion` | MERGEABLE | none | 0 |
| [#558](https://github.com/KitsuneKode/kunai/pull/558) | `7f59aedd62b7` | `fix/full-review-blockers-20261003` | MERGEABLE | none | 0 |
| [#557](https://github.com/KitsuneKode/kunai/pull/557) | `bd8df9dbb779` | `fix/full-review-blockers-20261003` | MERGEABLE | none | 0 |
| [#556](https://github.com/KitsuneKode/kunai/pull/556) | `6dd035443a52` | `fix/mobile-terminal-ownership-20261003` | MERGEABLE | none | 0 |
| [#554](https://github.com/KitsuneKode/kunai/pull/554) | `7de2abaf2b1f` | `main` | MERGEABLE | none | 0 |
| [#553](https://github.com/KitsuneKode/kunai/pull/553) | `c1caa4573d36` | `main` | MERGEABLE | none | 0 |
| [#545](https://github.com/KitsuneKode/kunai/pull/545) | `3243c0c139a2` | `fix/lifecycle-lows` | MERGEABLE | CHANGES_REQUESTED | 2 |
| [#544](https://github.com/KitsuneKode/kunai/pull/544) | `dfac31be4b28` | `fix/security-boundaries` | MERGEABLE | none | 0 |
| [#543](https://github.com/KitsuneKode/kunai/pull/543) | `1d4ce5202a32` | `fix/mobile-host-proof` | MERGEABLE | none | 0 |
| [#540](https://github.com/KitsuneKode/kunai/pull/540) | `4093fcfeea54` | `fix/audit-hardening` | MERGEABLE | none | 0 |
| [#539](https://github.com/KitsuneKode/kunai/pull/539) | `f4456ebf65ed` | `fix/interaction-trust` | MERGEABLE | none | 0 |
| [#508](https://github.com/KitsuneKode/kunai/pull/508) | `e1f9d0030331` | `main` | CONFLICTING | CHANGES_REQUESTED | 3 |
| [#507](https://github.com/KitsuneKode/kunai/pull/507) | `5eb60905221d` | `main` | CONFLICTING | none | 0 |
| [#500](https://github.com/KitsuneKode/kunai/pull/500) | `e5fd018af3d6` | `main` | MERGEABLE | CHANGES_REQUESTED | 0 |

## All open PRs at capture

| PR | Base | Title |
| --- | --- | --- |
| [#563](https://github.com/KitsuneKode/kunai/pull/563) | `fix/offline-provider-authority-20261003` | fix: harden CLI verification and fit onboarding to shell width |
| [#562](https://github.com/KitsuneKode/kunai/pull/562) | `fix/queue-view-states-20261003` | fix(offline): keep downloaded playback independent of providers |
| [#561](https://github.com/KitsuneKode/kunai/pull/561) | `fix/full-review-blockers-20261003` | fix(ci): isolate test credentials and restore stacked reviews |
| [#560](https://github.com/KitsuneKode/kunai/pull/560) | `docs/perf-lazy-search` | fix(docs): make the analytics page legible and explain its numbers |
| [#559](https://github.com/KitsuneKode/kunai/pull/559) | `fix/text-contrast-and-reduced-motion` | fix(design): readable error and milestone text, tiers that clear the selected row |
| [#558](https://github.com/KitsuneKode/kunai/pull/558) | `fix/full-review-blockers-20261003` | fix(queue): report startup accurately and prepare phone qualification |
| [#557](https://github.com/KitsuneKode/kunai/pull/557) | `fix/full-review-blockers-20261003` | fix(ci): publish fresh provider status from a clean worktree |
| [#556](https://github.com/KitsuneKode/kunai/pull/556) | `fix/mobile-terminal-ownership-20261003` | fix: repair production blockers and carry verified braces hardening |
| [#555](https://github.com/KitsuneKode/kunai/pull/555) | `main` | test: stop the browse search-failure test writing the real profile |
| [#554](https://github.com/KitsuneKode/kunai/pull/554) | `main` | fix(mobile): preserve cancellation and state recovery through terminal sessions |
| [#553](https://github.com/KitsuneKode/kunai/pull/553) | `main` | fix(app-shell): let the playback command palette own the keyboard |
| [#545](https://github.com/KitsuneKode/kunai/pull/545) | `fix/lifecycle-lows` | fix(shell): legacy mouse strip, orphan-flag warnings, display-column widths |
| [#544](https://github.com/KitsuneKode/kunai/pull/544) | `fix/security-boundaries` | fix: lifecycle lows — wedged downloads, orphan-safe kills, socket sweep, config write ordering |
| [#543](https://github.com/KitsuneKode/kunai/pull/543) | `fix/mobile-host-proof` | fix(security): close credential-leak and target-vetting gaps in playback plumbing |
| [#542](https://github.com/KitsuneKode/kunai/pull/542) | `fix/provider-classification` | fix(mobile): harden the host-proof preview runtime |
| [#541](https://github.com/KitsuneKode/kunai/pull/541) | `fix/lifecycle-destructive` | fix(providers): typed failure classification + stable dead-stream keys |
| [#540](https://github.com/KitsuneKode/kunai/pull/540) | `fix/audit-hardening` | fix(update): stop destructive paths from touching foreign files and crashing |
| [#539](https://github.com/KitsuneKode/kunai/pull/539) | `fix/interaction-trust` | fix(net): bound provider network trust boundaries — DNS, bodies, redirects, fan-out |
| [#538](https://github.com/KitsuneKode/kunai/pull/538) | `docs/home-redesign-workshop` | perf(docs): load search on demand and fix the dead code-comment contrast rule |
| [#537](https://github.com/KitsuneKode/kunai/pull/537) | `docs/seo-social-cards-jsonld` | feat(docs): redesign the home sections, add the workshop, and shrink the nav on scroll |
| [#536](https://github.com/KitsuneKode/kunai/pull/536) | `docs/site-home-support-type-motion` | feat(docs): per-page social cards, richer JSON-LD and a truthful sitemap lastmod |
| [#535](https://github.com/KitsuneKode/kunai/pull/535) | `docs/kanna-walks` | feat(docs): home polish, /support, a real type scale and calmer docs chrome |
| [#534](https://github.com/KitsuneKode/kunai/pull/534) | `docs/analytics-sparklines-release-markers` | feat(docs): Kanna walks, with a stride that follows distance and a heading lean |
| [#533](https://github.com/KitsuneKode/kunai/pull/533) | `docs/palette-ember-dusk-1-1` | feat(docs): analytics sparklines, release markers and a 7-day average |
| [#532](https://github.com/KitsuneKode/kunai/pull/532) | `main` | feat(design): refine Ember Dusk contrast and separate crowded hues |
| [#531](https://github.com/KitsuneKode/kunai/pull/531) | `main` | chore: remove dead modules and strip banner headers |
| [#530](https://github.com/KitsuneKode/kunai/pull/530) | `main` | fix(design): readable secondary text, reduced-motion spinner, reproducible UI demo |
| [#528](https://github.com/KitsuneKode/kunai/pull/528) | `fix/ux-trust-fixes` | fix(ux): make overlay/palette actions act on the item the user chose |
| [#527](https://github.com/KitsuneKode/kunai/pull/527) | `fix/reliability-criticals` | fix(ux): make advertised keys match real handlers |
| [#526](https://github.com/KitsuneKode/kunai/pull/526) | `fix/provider-trust-boundary` | fix(reliability): contain playback callbacks and wake download retries |
| [#525](https://github.com/KitsuneKode/kunai/pull/525) | `chore/production-scaffolding` | fix(security): harden the provider→local trust boundary |
| [#523](https://github.com/KitsuneKode/kunai/pull/523) | `fix/playback-exit-honesty` | chore: security/community scaffolding, SHA-pinned actions, dependency monitoring |
| [#522](https://github.com/KitsuneKode/kunai/pull/522) | `feat/mouse-input-foundation` | fix(player): external SIGKILL ≠ quit · honest playback_events finale · agent:session --fake-mpv-mode |
| [#521](https://github.com/KitsuneKode/kunai/pull/521) | `fix/mpv-crash-completion` | feat(app-shell): SGR mouse input foundation — proxy stdin + hit regions |
| [#520](https://github.com/KitsuneKode/kunai/pull/520) | `feat/browse-overlay` | fix(player): mpv crash never reads as a completed watch |
| [#519](https://github.com/KitsuneKode/kunai/pull/519) | `feat/browse-result-narrow` | refactor(app-shell): extract useBrowseOverlay — details overlay cluster |
| [#517](https://github.com/KitsuneKode/kunai/pull/517) | `feat/resolve-diagnostics-classes` | refactor(app-shell): extract useResultNarrow — narrow/badges/Esc-layer cluster |
| [#516](https://github.com/KitsuneKode/kunai/pull/516) | `feat/browse-idle-surface` | fix(diagnostics): map provider failure classes honestly at the boundary |
| [#515](https://github.com/KitsuneKode/kunai/pull/515) | `feat/command-palette-hook` | refactor(app-shell): extract useIdleSurface — idle surface state + navigation |
| [#513](https://github.com/KitsuneKode/kunai/pull/513) | `feat/relay-schema-boundary` | refactor(app-shell): useCommandPalette — shared palette state + key choreography |
| [#511](https://github.com/KitsuneKode/kunai/pull/511) | `feat/provider-query-cache` | feat(relay): validate the RPC envelope against @kunai/schemas at both ends |
| [#510](https://github.com/KitsuneKode/kunai/pull/510) | `feat/provider-resilience` | feat(providers): ProviderQueryCache — keyed async-cache primitive + 5 migrations |
| [#509](https://github.com/KitsuneKode/kunai/pull/509) | `feat/provider-reliability` | feat(providers): unified endpoint resilience + Retry-After honoring |
| [#508](https://github.com/KitsuneKode/kunai/pull/508) | `main` | feat(providers): reliability overhaul — honest failure taxonomy, shared transport, AnimeKai |
| [#507](https://github.com/KitsuneKode/kunai/pull/507) | `main` | Close the CLI trust gaps that were still lying |
| [#506](https://github.com/KitsuneKode/kunai/pull/506) | `fix/shell-ux-c3` | chore(repo): hygiene gates — failure classifiers, cache bounds, relay token, contract tests |
| [#505](https://github.com/KitsuneKode/kunai/pull/505) | `fix/shell-ux-c1` | fix(cli): focus-aware input ownership and press-again destructive confirms |
| [#504](https://github.com/KitsuneKode/kunai/pull/504) | `fix/shell-ux-c2` | feat(cli): watched-download cleanup review, OS notifications, retire dead settings |
| [#503](https://github.com/KitsuneKode/kunai/pull/503) | `fix/relay-roster` | fix(cli): honest shell UX — details-card overlap, doctor writability probe, catalog failure messages |
| [#502](https://github.com/KitsuneKode/kunai/pull/502) | `fix/config-integrity` | fix(relay,providers): one production roster, honest relay refusals |
| [#501](https://github.com/KitsuneKode/kunai/pull/501) | `main` | fix(cli): honor --offline, stop cross-window config clobbering, survive malformed config |
| [#500](https://github.com/KitsuneKode/kunai/pull/500) | `main` | fix(providers): gate movy, hianime, kickassanime, and animegg |
| [#499](https://github.com/KitsuneKode/kunai/pull/499) | `main` | docs: document the mobile capability preview honestly |
| [#327](https://github.com/KitsuneKode/kunai/pull/327) | `main` | chore: version packages |
| [#306](https://github.com/KitsuneKode/kunai/pull/306) | `main` | Chromecast audo video |
| [#287](https://github.com/KitsuneKode/kunai/pull/287) | `main` | feat: add Android Termux player handoff preview |
| [#255](https://github.com/KitsuneKode/kunai/pull/255) | `main` | refactor: clear anti-slop chained assertions from src and make the rule blocking [hold until after 0.3.0] |

## All open issues at capture

- [#552: Mouse coverage pass: hit regions on remaining interactive surfaces](https://github.com/KitsuneKode/kunai/issues/552)
- [#551: Expand fake-mpv modes for the verify harness](https://github.com/KitsuneKode/kunai/issues/551)
- [#550: Consolidate stream-health evidence: failure ledger, endpoint health, and resolve trace](https://github.com/KitsuneKode/kunai/issues/550)
- [#549: Episode selector flag: -e/--episode to jump straight to an episode](https://github.com/KitsuneKode/kunai/issues/549)
- [#548: Headless resolve surface: non-interactive --resolve with --json output](https://github.com/KitsuneKode/kunai/issues/548)
- [#547: Isolate the terminal query/response channel from user input on stdin](https://github.com/KitsuneKode/kunai/issues/547)
- [#546: Terminal capability layer for unicode glyphs — fallback set for non-unicode terminals](https://github.com/KitsuneKode/kunai/issues/546)
- [#529: docs(release): write the trusted-publishing preflight section properly](https://github.com/KitsuneKode/kunai/issues/529)
- [#480: TMDB unreachable under ISP-level DNS interference — add DoH or relay fallback](https://github.com/KitsuneKode/kunai/issues/480)
- [#472: ci: lint:anti-slop is 5,427 errors on main and is neither gated nor baselined](https://github.com/KitsuneKode/kunai/issues/472)
- [#432: test flakes: ordering-gate sleeps and elapsed-bound assertions still time-coupled](https://github.com/KitsuneKode/kunai/issues/432)
- [#422: tracking: upstream provider outages (2026-09-21) — videasy, anidb, allanime, miruro stream host](https://github.com/KitsuneKode/kunai/issues/422)
- [#343: Docs: replace stale ESLint wording with Oxlint contributor commands](https://github.com/KitsuneKode/kunai/issues/343)
- [#342: Docs: align quickstart Bun prerequisite with package minimum](https://github.com/KitsuneKode/kunai/issues/342)
- [#319: Test suite is flaky because timing assertions race the parallel runner](https://github.com/KitsuneKode/kunai/issues/319)
- [#278: Guard against a changeset landing on an already-staged, unpublished version (third recurrence)](https://github.com/KitsuneKode/kunai/issues/278)
- [#275: First paint waits on probing, container creation, and analytics init — profile it](https://github.com/KitsuneKode/kunai/issues/275)
- [#274: Measure before changing the 5s provider hedge: cycle sources within a provider first?](https://github.com/KitsuneKode/kunai/issues/274)
- [#267: providers: Rivestream feeds no endpoint health, and 'not-found' must never be treated as an unhealthy host](https://github.com/KitsuneKode/kunai/issues/267)
- [#266: anime identity: season ordinals cannot be resolved from a title string, and every provider re-guesses them](https://github.com/KitsuneKode/kunai/issues/266)
- [#195: Miruro resolve is ~10s on the success path, with no per-stage trace](https://github.com/KitsuneKode/kunai/issues/195)
- [#121: Package-manager installs cannot self-update: verify the notify path end to end](https://github.com/KitsuneKode/kunai/issues/121)
- [#113: Type collisions: EpisodeInfo means two things; SubtitleTrack vs SubtitleEntry](https://github.com/KitsuneKode/kunai/issues/113)
- [#112: Container is 91 members with 30 unsafe test casts — add createMockContainer](https://github.com/KitsuneKode/kunai/issues/112)
- [#111: Layering allowlist: document the ratchet, then burn it down opportunistically](https://github.com/KitsuneKode/kunai/issues/111)
- [#110: Large-module inventory: app-shell is the real concentration, not PlaybackPhase](https://github.com/KitsuneKode/kunai/issues/110)
- [#109: Flat root modules in apps/cli/src bypass the layering gate](https://github.com/KitsuneKode/kunai/issues/109)
- [#106: crypto-js removal is an EVP_BytesToKey reimplementation, not a swap](https://github.com/KitsuneKode/kunai/issues/106)
