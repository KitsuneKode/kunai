# Kunai — Roadmap

Last updated: 2026-08-13

This is the **only index of active work**. Everything in `.plans/` is unfinished
by construction; everything finished lives in [`archive/`](./archive/README.md).

**Code wins.** If a plan disagrees with the repo, the repo is right — fix the
plan in the same change set. Shipped behavior is described in `.docs/` (how it
works) and `docs/users/` (what users see), not here.

## Execution mode

CLI first. Web, desktop, remote sync, paid cloud compute, premium dashboards,
watch rooms, and account-required flows are **parked** until the CLI runtime
feels excellent. Direction for those surfaces is recorded in
[kunai-architecture-and-cache-hardening.md](./kunai-architecture-and-cache-hardening.md)
and [kunai-experience-and-growth-moat.md](./kunai-experience-and-growth-moat.md)
so it is not re-derived — not because it is scheduled.

## Locked decisions

Read these before proposing a change to scope, contracts, or CLI surface.

| Doc                                                                                  | Owns                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [kunai-beta-v1-scope-and-contracts.md](./kunai-beta-v1-scope-and-contracts.md)       | Beta v1 scope, architecture seams, telemetry posture   |
| [kunai-execution-passes-and-cli-modes.md](./kunai-execution-passes-and-cli-modes.md) | Execution passes, CLI modes, autoskip                  |
| [kunai-principal-grill-qa.md](./kunai-principal-grill-qa.md)                         | Product/architecture decisions already pressure-tested |
| [beta-readiness.md](./beta-readiness.md)                                             | Beta gate checklist                                    |

## Active tracks

Every row has real unstarted work. A track moves to `archive/` when its core
lands; leftover polish becomes a row here, not a surviving plan file.

### Shell and UI

| Track                       | Remaining                                             | Plan                                                                                   |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Single mounted content tree | Collapse `SearchPhase`/`PlaybackPhase` launcher loops | [phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md) |
| Persistent shell            | Full back-stack, root-owned footer                    | [persistent-shell-implementation.md](./persistent-shell-implementation.md)             |
| Fullscreen root shell       | Flatten nested borders, root-owned chrome             | [fullscreen-root-shell-redesign.md](./fullscreen-root-shell-redesign.md)               |
| Sakura theme rollout        | Remaining surface slices after the token foundation   | [sakura-rollout.md](./sakura-rollout.md)                                               |
| Loading shell               | Animation redesign + bug fix                          | [loading-shell-redesign.md](./loading-shell-redesign.md)                               |
| Terminal image protocol     | Flicker hardening, `ink-shell` split                  | [ui-polish-and-image-protocol.md](./ui-polish-and-image-protocol.md)                   |
| Poster protocol signoff     | Real-terminal and fallback release evidence           | [poster-protocol-release-smokes.md](./poster-protocol-release-smokes.md)               |
| Sixel in Ink                | Windows Terminal framebuffer smoke                    | [sixel-in-ink.md](./sixel-in-ink.md)                                                   |
| CLI UX overhaul             | Structural gaps behind the shipped product direction  | [cli-ux-overhaul.md](./cli-ux-overhaul.md)                                             |
| Hybrid UI contract          | Contract stabilization                                | [hybrid-ui-contract-stabilization.md](./hybrid-ui-contract-stabilization.md)           |

### Playback and providers

| Track                        | Remaining                                                     | Plan                                                                                                       |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Playback/media runtime       | Phase 2 controller seam follow-through                        | [phase-2-playback-media-runtime.md](./phase-2-playback-media-runtime.md)                                   |
| mpv lifecycle + history      | Reopen reliability, teardown hardening                        | [mpv-lifecycle-and-history-hardening.md](./mpv-lifecycle-and-history-hardening.md)                         |
| Cross-platform mpv IPC       | Windows named-pipe parity, bridge, packaging clarity          | [cross-platform-mpv-ipc-and-playback-parity.md](./cross-platform-mpv-ipc-and-playback-parity.md)           |
| Playback UX hardening        | Phase 4 provider options                                      | [cli-playback-ux-hardening.md](./cli-playback-ux-hardening.md)                                             |
| Provider resolve hardening   | Slices B and C — cache/health defects, latency-aware ordering | [provider-resolve-hardening-handoff.md](./provider-resolve-hardening-handoff.md)                           |
| Provider hardening           | Research and scraper capability roadmap                       | [provider-hardening.md](./provider-hardening.md)                                                           |
| Source inventory reliability | Provider-package factory extraction                           | [provider-source-inventory-reliability-hardening.md](./provider-source-inventory-reliability-hardening.md) |
| Provider result contract     | Planned before broad `@kunai/core` extraction                 | [provider-result-contract.md](./provider-result-contract.md)                                               |
| Beta UI/provider hardening   | Tasks 8–10: input routing, subtitle calls, display honesty    | [beta-ui-provider-runtime-hardening.md](./beta-ui-provider-runtime-hardening.md)                           |
| Resolve UX & Playwright      | Pick up during a Playwright/provider reliability pass         | [resolve-ux-and-playwright-lifecycle.md](./resolve-ux-and-playwright-lifecycle.md)                         |

### Catalog, offline, recovery

| Track                           | Remaining                                                 | Plan                                                                                                         |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Catalog identity parity         | Phase 4 UX badges                                         | [catalog-identity-parity.md](./catalog-identity-parity.md)                                                   |
| Release schedules               | TV weekly/season projection                               | [catalog-release-schedule-service.md](./catalog-release-schedule-service.md)                                 |
| Upcoming-episode UX             | `upcomingNext` vs released `nextEpisode` mutual exclusion | [series-catalog-end-state-and-upcoming-episode-ux.md](./series-catalog-end-state-and-upcoming-episode-ux.md) |
| Download / offline / onboarding | Download slices, offline library, setup wizard            | [download-offline-onboarding.md](./download-offline-onboarding.md)                                           |
| Provider-independent offline    | Keep downloads playable after provider retirement         | [offline-provider-independent-playback.md](./offline-provider-independent-playback.md)                       |
| Offline artwork cache           | Library previews                                          | [offline-artwork-cache-and-library-previews.md](./offline-artwork-cache-and-library-previews.md)             |
| Network status                  | Offline suggestion surface                                | [network-status-and-offline-suggestion.md](./network-status-and-offline-suggestion.md)                       |
| Recovery policy engine          | Policy modes                                              | [recovery-policy-engine.md](./recovery-policy-engine.md)                                                     |
| Production recovery hardening   | Coordinating track for the recovery cluster               | [production-recovery-hardening.md](./production-recovery-hardening.md)                                       |
| Runtime diagnostics boundary    | Offline boundary hardening                                | [runtime-diagnostics-offline-boundary-hardening.md](./runtime-diagnostics-offline-boundary-hardening.md)     |
| Diagnostics reporting UX        | Report-issue flow polish                                  | [diagnostics-reporting-ux.md](./diagnostics-reporting-ux.md)                                                 |
| Boundary + adaptive downloads   | Reviewed design, not started                              | [boundary-hardening-and-adaptive-downloads.md](./boundary-hardening-and-adaptive-downloads.md)               |
| Presence integrations           | Richer activity polish                                    | [presence-integrations.md](./presence-integrations.md)                                                       |

### Structure

| Track                        | Remaining                                                | Plan                                                                         |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Turborepo package boundaries | Phase 4G provider package migration                      | [turborepo-and-package-boundaries.md](./turborepo-and-package-boundaries.md) |
| Architecture review          | Living status board (report: `architecture-review.html`) | [architecture-review.md](./architecture-review.md)                           |
| Codebase architecture sweep  | Planning                                                 | [codebase-architecture-sweep.md](./codebase-architecture-sweep.md)           |
| CLI structure and naming     | Planned                                                  | [cli-structure-and-naming.md](./cli-structure-and-naming.md)                 |
| Search/catalog service       | Active design; implementation stays pragmatic            | [search-service.md](./search-service.md)                                     |

## Also here

- [agent-routing-prompts.md](./agent-routing-prompts.md) — reusable prompts for
  routing multi-agent work. Reference, not a track.

## Separate plan trackers

`.plans/` is not the only one. Do not conflate them:

- **`plans/`** (no dot) — numbered production-readiness plans from an external
  audit, with their own status board in [`../plans/README.md`](../plans/README.md).
- **`docs/superpowers/plans/` and `docs/superpowers/specs/`** — dated
  spec-driven-development artifacts, one pair per feature.

## Rules for this folder

1. `.plans/` holds **unfinished work only**. Finished work moves to
   [`archive/`](./archive/README.md) in the change set that finishes it.
2. This file is the only index for `.plans/`. Do not add a second status board.
3. Every plan carries a `Status:` line that is true. A plan whose core landed is
   archived even if polish remains — the polish becomes one row above.
4. Detail belongs in the plan file, not in this file.
5. Don't record shipped behavior here. That belongs in `.docs/` or `docs/users/`.
