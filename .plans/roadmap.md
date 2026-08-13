# Kunai — Roadmap

Last updated: 2026-08-14

This is the **only index of active work** in `.plans/`. Everything indexed here
is unfinished. Landed, superseded, and one-shot plans live in
[`archive/`](./archive/README.md) and carry **no authority**.

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

| Track                       | Remaining                                             | Plan                                                                                   |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Single mounted content tree | Collapse `SearchPhase`/`PlaybackPhase` launcher loops | [phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md) |
| Persistent shell            | Full back-stack, root-owned footer                    | [persistent-shell-implementation.md](./persistent-shell-implementation.md)             |
| Fullscreen root shell       | Flatten remaining nested chrome                       | [fullscreen-root-shell-redesign.md](./fullscreen-root-shell-redesign.md)               |
| Sakura theme rollout        | Remaining surfaces after the token foundation         | [sakura-rollout.md](./sakura-rollout.md)                                               |
| Terminal image protocol     | Flicker hardening and `ink-shell` split               | [ui-polish-and-image-protocol.md](./ui-polish-and-image-protocol.md)                   |

### Playback and providers

| Track                      | Remaining                                                               | Plan                                                                               |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Provider resolve hardening | Health recovery, latency ordering, and measured hedge-delay calibration | [provider-resolve-hardening-handoff.md](./provider-resolve-hardening-handoff.md)   |
| Provider hardening         | Research and scraper capability roadmap                                 | [provider-hardening.md](./provider-hardening.md)                                   |
| Provider result contract   | Contract work before broad `@kunai/core` extraction                     | [provider-result-contract.md](./provider-result-contract.md)                       |
| Beta UI/provider hardening | Tasks 8–10: input routing, subtitle calls, display honesty              | [beta-ui-provider-runtime-hardening.md](./beta-ui-provider-runtime-hardening.md)   |
| Resolve UX and Playwright  | Pick up during a browser/provider reliability pass                      | [resolve-ux-and-playwright-lifecycle.md](./resolve-ux-and-playwright-lifecycle.md) |

### Offline and release stability

| Track                        | Remaining                                                | Plan                                                                                             |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Provider-independent offline | Keep downloads playable after provider retirement        | [offline-provider-independent-playback.md](./offline-provider-independent-playback.md)           |
| Offline artwork cache        | Library previews                                         | [offline-artwork-cache-and-library-previews.md](./offline-artwork-cache-and-library-previews.md) |
| Boundary + downloads         | Reviewed adaptive-download design, not started           | [boundary-hardening-and-adaptive-downloads.md](./boundary-hardening-and-adaptive-downloads.md)   |
| Poster release smokes        | Real-terminal Kitty, iTerm2, Sixel, and multiplexer pass | [poster-protocol-release-smokes.md](./poster-protocol-release-smokes.md)                         |

### Structure

| Track                        | Remaining                                     | Plan                                                                         |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| Turborepo package boundaries | Phase 4G provider package migration           | [turborepo-and-package-boundaries.md](./turborepo-and-package-boundaries.md) |
| Codebase architecture sweep  | Planning                                      | [codebase-architecture-sweep.md](./codebase-architecture-sweep.md)           |
| CLI structure and naming     | Planned                                       | [cli-structure-and-naming.md](./cli-structure-and-naming.md)                 |
| Search/catalog service       | Active design; implementation stays pragmatic | [search-service.md](./search-service.md)                                     |

## Separate tracker

`plans/` (without a dot) holds numbered production-readiness residue from the
external audit. Its board is [`../plans/README.md`](../plans/README.md).

The old `docs/superpowers/` wave is closed. Its artifacts live under
`docs/superpowers/archive/` and have no authority. Any verified residue was
transferred to this roadmap or the numbered board.

## Rules

1. `.plans/` holds unfinished work only.
2. This file is the only index for `.plans/`.
3. Every active plan carries a truthful status line.
4. A landed core moves to `archive/`; leftover polish becomes one row above.
5. Detail belongs in a plan, not this index.
6. Never cite `archive/` as current behavior.
