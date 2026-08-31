# Kunai — Roadmap

Last updated: 2026-08-31

This is the **only index of active work** in `.plans/`. Everything indexed here
is unfinished. Landed, superseded, and one-shot plans live in
[`.archive/`](../.archive/README.md) and carry **no authority**.

**Code wins.** If a plan disagrees with the repo, the repo is right — fix the
plan in the same change set. Shipped behavior belongs in `.docs/` and
`docs/users/`, not here.

## Execution mode

CLI first. Web, desktop, remote sync, paid cloud compute, premium dashboards,
watch rooms, and account-required flows are parked until the CLI runtime feels
excellent. Their direction is recorded in
[kunai-architecture-and-cache-hardening.md](./kunai-architecture-and-cache-hardening.md)
and [kunai-experience-and-growth-moat.md](./kunai-experience-and-growth-moat.md)
so it is not re-derived — not because it is scheduled.

## Locked decisions

| Doc                                                                                  | Owns                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [kunai-beta-v1-scope-and-contracts.md](./kunai-beta-v1-scope-and-contracts.md)       | Beta v1 scope, architecture seams, telemetry posture   |
| [kunai-execution-passes-and-cli-modes.md](./kunai-execution-passes-and-cli-modes.md) | Execution passes, CLI modes, autoskip                  |
| [kunai-principal-grill-qa.md](./kunai-principal-grill-qa.md)                         | Product/architecture decisions already pressure-tested |

## Active tracks

Every row has real remaining work. When a plan's core lands, move it to the
archive and put only the residue here.

### Shell and UI

| Track                       | Remaining                                                 | Plan                                                                                   |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Single mounted content tree | Collapse `SearchPhase`/`PlaybackPhase` launcher loops     | [phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md) |
| Persistent shell            | Full back-stack, root-owned footer                        | [persistent-shell-implementation.md](./persistent-shell-implementation.md)             |
| Fullscreen root shell       | Flatten remaining nested chrome                           | [fullscreen-root-shell-redesign.md](./fullscreen-root-shell-redesign.md)               |
| Sakura theme rollout        | Remaining surfaces after the token foundation             | [sakura-rollout.md](./sakura-rollout.md)                                               |
| Terminal image protocol     | Flicker hardening and `ink-shell` split                   | [ui-polish-and-image-protocol.md](./ui-polish-and-image-protocol.md)                   |
| Kanna character system      | `seek`/`peek` redraws, then tracing the four raster poses | [2026-08-31-kanna-character-system.md](./2026-08-31-kanna-character-system.md)         |
| Kanna voice and presence    | Remaining voice moments, terminal reactions, pose map     | [kanna-mascot-personality.md](./kanna-mascot-personality.md)                           |

### Playback and providers

| Track                      | Remaining                                                               | Plan                                                                               |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Provider resolve hardening | Health recovery, latency ordering, and measured hedge-delay calibration | [provider-resolve-hardening-handoff.md](./provider-resolve-hardening-handoff.md)   |
| Provider hardening         | Research and scraper capability roadmap                                 | [provider-hardening.md](./provider-hardening.md)                                   |
| Provider result contract   | Contract work before broad `@kunai/core` extraction                     | [provider-result-contract.md](./provider-result-contract.md)                       |
| Beta UI/provider hardening | Tasks 8–10: input routing, subtitle calls, display honesty              | [beta-ui-provider-runtime-hardening.md](./beta-ui-provider-runtime-hardening.md)   |
| Resolve UX and Playwright  | Pick up during a browser/provider reliability pass                      | [resolve-ux-and-playwright-lifecycle.md](./resolve-ux-and-playwright-lifecycle.md) |

### Offline and release stability

| Track                          | Remaining                                                                                            | Plan                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0.3.0 merge train              | Merge order, chain-A publication, regression watch                                                   | [2026-08-24-0-3-0-merge-train.md](./2026-08-24-0-3-0-merge-train.md)                                 |
| Provider-independent offline   | Keep downloads playable after provider retirement                                                    | [offline-provider-independent-playback.md](./offline-provider-independent-playback.md)               |
| Offline artwork cache          | Library previews                                                                                     | [offline-artwork-cache-and-library-previews.md](./offline-artwork-cache-and-library-previews.md)     |
| Boundary + downloads           | Reviewed adaptive-download design, not started                                                       | [boundary-hardening-and-adaptive-downloads.md](./boundary-hardening-and-adaptive-downloads.md)       |
| Poster release smokes          | Real-terminal Kitty, iTerm2, Sixel, and multiplexer pass                                             | [poster-protocol-release-smokes.md](./poster-protocol-release-smokes.md)                             |
| Setup wizard release hardening | Independent media language profiles, cancellable OAuth, then real-terminal restore-point walkthrough | [2026-08-27-release-setup-and-oauth-hardening.md](./2026-08-27-release-setup-and-oauth-hardening.md) |

### Analytics

| Track                    | Remaining                                                                                                                                  | Plan                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Usage analytics redesign | Explicit opt-in implementation is complete; verified Neon/Vercel deployment, secret/firewall/cost controls, and live endpoint smoke remain | [usage-analytics-redesign.md](./usage-analytics-redesign.md) · [design](./usage-analytics-redesign-design.md) |

### Docs

| Track                           | Remaining                                                                                                                            | Plan                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Analytics series + social cards | Serve the retained `daily_rollup` history, adoption/trend charts, per-share OG images                                                | [2026-08-26-analytics-series-and-social-cards.md](./2026-08-26-analytics-series-and-social-cards.md) |
| User docs overhaul              | Accuracy/framing PR first; then first-run, debugging playbook, coverage, nav, agent-docs, deploy `apps/docs` to kunai.kitsunekode.in | [2026-08-18-user-docs-overhaul.md](./2026-08-18-user-docs-overhaul.md)                               |

### Structure

| Track                        | Remaining                                                                                                                                                                                                          | Plan                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Turborepo package boundaries | Phase 4G provider package migration                                                                                                                                                                                | [turborepo-and-package-boundaries.md](./turborepo-and-package-boundaries.md) |
| Codebase architecture sweep  | Planning                                                                                                                                                                                                           | [codebase-architecture-sweep.md](./codebase-architecture-sweep.md)           |
| CLI structure and naming     | Planned                                                                                                                                                                                                            | [cli-structure-and-naming.md](./cli-structure-and-naming.md)                 |
| Search/catalog service       | Active design; implementation stays pragmatic                                                                                                                                                                      | [search-service.md](./search-service.md)                                     |
| Duplicated domain types      | `ProviderLane` declared identically in `apps/cli/src/domain/types.ts` and `packages/types/src/index.ts`; neither marked canonical. Same shape as the `MediaKind` duplication. Pick one owner, re-export the other. | [turborepo-and-package-boundaries.md](./turborepo-and-package-boundaries.md) |

### Production readiness — external audit

Numbered plans from an external audit. They keep their original numbers because
the K-reconciliation below and the commit history both cite them by id.

| Plan                                                | Remaining work                                                            | Status                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| [006](./006-startup-defer-network-and-providers.md) | Startup provider loading residue                                          | BLOCKED (engine registry is intentionally fixed)  |
| [008](./008-tui-timer-and-poster-perf.md)           | Download-alert root coupling                                              | BLOCKED (other timer/poster slices landed)        |
| [010](./010-characterization-tests-for-giants.md)   | Characterization net for private `AppRoot`                                | BLOCKED (needs a full-container harness)          |
| [011](./011-split-shell-workflows.md)               | Split `shell-workflows.ts`                                                | BLOCKED by 010                                    |
| [012](./012-decompose-playback-phase.md)            | Extract `PlaybackPhase` transition core                                   | BLOCKED by 010                                    |
| [013](./013-split-ink-shell-host-surface.md)        | Split Ink host/surface/overlay winner                                     | BLOCKED by 010                                    |
| [014](./014-enforce-layering-boundaries.md)         | Retire remaining baselined layer inversions                               | BLOCKED (boundary ratchet is active)              |
| [015](./015-retire-legacy-flat-modules.md)          | Retire legacy flat root modules                                           | BLOCKED by 011 and 012                            |
| [021](./021-provider-contract-enforcement.md)       | Enforce or remove unread provider/relay contracts                         | PARTIAL; K-04/K-08 release slice complete         |
| [022](./022-shell-interaction-coherence.md)         | Destructive confirms, filter capture, errors, Esc semantics               | PARTIAL; 022.1 landed                             |
| [023](./023-cli-surface-honesty.md)                 | CLI surface honesty                                                       | PARTIAL; K-16 fixed by PR #144                    |
| [030](./030-distribution-documentation-truth.md)    | Distribution documentation truth                                          | TODO after release behavior settles               |
| [032](./032-sync-identity-and-capability-truth.md)  | Disposable-account production container → outbox → restart → remote smoke | PARTIAL; deterministic implementation is complete |
| [043](./043-history-key-migration-transaction.md)   | Transactional legacy history-key migration                                | TODO; independent data-migration PR               |

Status values: TODO · PARTIAL · BLOCKED (with reason) · IN PROGRESS.

## K-01–K-17 reconciliation

The local `docs/agents/kunai-audit-handoff.html` is an audit snapshot taken
before most of this landed, **not** a current authority. Most of its "open"
findings are fixed below, and its suggested first week would redo landed work.
It is deliberately ignored by Git and agent indexes. This table replaces its
status claims.

Count: **17 fixed, 0 open**.

| Finding | Current status | Evidence / owner                                                                                                                                                       |
| ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-01    | FIXED          | Exact Bun connect strings remain covered by network/TMDB regression tests.                                                                                             |
| K-02    | FIXED          | PR #48 exports every diagnostic category in support bundles.                                                                                                           |
| K-03    | FIXED          | PR #42 preserves sticky offline truth and search failure copy.                                                                                                         |
| K-04    | FIXED          | Removed the unread video fallback flag, media-host allowlist, and URL rewrite helper. Relay configuration is metadata-only; no shared video relay was added.           |
| K-05    | FIXED          | PR #46 preserves the working Windows launcher across activation failure.                                                                                               |
| K-06    | FIXED          | Session phase moves from ready to playing only inside the confirmed `playback-started` callback.                                                                       |
| K-07    | FIXED          | PR #27 restores playing after progress resumes and rejects stale mpv work.                                                                                             |
| K-08    | FIXED          | Removed the retired video-relay symbol and its baseline. Geo-block detection remains separately named as plan 021 Stage 2 debt rather than hidden in a generic pair.   |
| K-09    | FIXED          | PR #45 preserves the last-known-good atomic JSON target on Windows.                                                                                                    |
| K-10    | FIXED          | This reconciliation removes stale top-level TODO/checklist authorities, archives landed plans, and corrects provider/poster docs.                                      |
| K-11    | FIXED          | Auto-advance reads one exact queue head before catalog planning, so play-next interrupts before countdown while ordinary rows wait.                                    |
| K-12    | FIXED          | PR #47 adds download claim CAS, state-safe publication, and crash recovery.                                                                                            |
| K-13    | FIXED          | One-shot IPC bootstrap failure terminates and reaps its owned child; generation tests prevent clearing a replacement control.                                          |
| K-14    | FIXED          | PR #37 gives slow installer suites an explicit reachable timeout budget.                                                                                               |
| K-15    | FIXED          | PR #44 structurally contains recursive staging cleanup.                                                                                                                |
| K-16    | FIXED          | PR #144 added a pure launch-plan reader that exits before locks, storage, container bootstrap, probes, or dependency checks; protocol and rollback plans remain valid. |
| K-17    | FIXED          | PR #53: AllAnime and Miruro prefer a proven season-relative episode; absolute-only inputs retain absolute routing.                                                     |

## Release-focused train

1. The docs/truth reconciliation and plan 047 lifecycle slice are complete.
2. Provider routing plan 046 and the plan 021 K-04/K-08 release slice are
   complete. PR #144 completed K-16 without narrowing valid launch previews.
3. Execute plan 043 as its own migration PR.
4. The rebased tracker-sync implementation and plan 032's deterministic work
   are complete. Keep sync experimental until the disposable-account live smoke
   proves the production container → SQLite outbox → restart → remote mutation path.
5. Run the deterministic release gate, provider signoff, real mpv playback,
   and poster-protocol smokes. Only then merge version PR #31.

The release PR is intentionally last: Changesets will keep updating it while
stability fixes merge, and merging it early would version an incomplete
candidate.

## Rules

1. `.plans/` holds unfinished work only, and is the **only** plan directory.
   There is no second board.
2. This file is the only index for `.plans/`. A plan that is not indexed here
   does not exist.
3. Every active plan carries a truthful status line.
4. A landed core moves to `.archive/plans/` (or `.archive/numbered-plans/` for a
   numbered audit plan); leftover polish becomes one row above.
5. Detail belongs in a plan, not this index.
6. Never cite `.archive/` as current behavior.
7. Numbered plans keep their ids. Do not renumber — the K-reconciliation and the
   commit history cite them.
