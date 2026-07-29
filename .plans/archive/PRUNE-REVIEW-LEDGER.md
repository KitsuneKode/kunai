# `.plans/` prune review ledger

**Status:** Review only — no files were archived in this pass. Approve clusters below before any moves to `.plans/archive/`.

**Canonical index:** [plan-implementation-truth.md](plan-implementation-truth.md) overrides stale plan headers.

## Always keep (meta + locked scope)

| Plan                                      | Why keep                     |
| ----------------------------------------- | ---------------------------- |
| `plan-implementation-truth.md`            | Canonical plan-vs-code index |
| `roadmap.md`                              | Short active index           |
| `agent-routing-prompts.md`                | Agent entry routing          |
| `kunai-beta-v1-scope-and-contracts.md`    | Locked beta scope            |
| `kunai-execution-passes-and-cli-modes.md` | CLI modes authority          |
| `beta-readiness.md`                       | Release gate                 |

## Recommended archive — superseded shell/UI (7 files)

| Plan                                        | Why archive                      | Superseded by                                     |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `ink-migration.md`                          | Superseded; Ink baseline shipped | `persistent-shell-implementation.md`              |
| `cli-ux-overhaul.md`                        | Mostly implemented               | `persistent-shell-implementation.md`              |
| `sakura-rollout.md`                         | Sakura parity landed             | `kitsune-design-system-and-recommendations.md`    |
| `sakura-shared-primitives-recovery-plan.md` | Complete                         | Sakura primitives in code                         |
| `sakura-parallel-agent-prompts.md`          | Historical agent prompts         | —                                                 |
| `sakura-agent-briefs.md`                    | S1 migration done                | —                                                 |
| `tui-polish-pass-ii.md`                     | References deleted DiscoverShell | `daily-use-ux-discovery-and-runtime-hardening.md` |

## Recommended archive — Sakura overlap

Keep `kitsune-design-system-and-recommendations.md` + one delegate (`2026-05-28-sakura-remaining-important-work.md`). Archive other Sakura overlap plans listed in the docs truth plan Appendix A.

## Recommended archive — implemented slices (~25 files)

Examples with truth index status Implemented/complete: `post-playback-fast-path.md`, `search-filter-state.md`, `cache-and-mpv-runtime.md`, `diagnostics-and-debuggability-v2.md`, `provider-contract-v2.md`, `repo-infrastructure.md`, and other one-shot slices marked complete in [plan-implementation-truth.md](plan-implementation-truth.md).

## Recommended keep — active execution (~20 files)

`persistent-shell-implementation.md`, `download-offline-onboarding.md`, `provider-hardening.md`, `turborepo-and-package-boundaries.md`, `presence-integrations.md`, `catalog-release-schedule-service.md`, and other tracks still open in the truth index.

## Recommended merge (not delete)

| From                                                | Into                                                 |
| --------------------------------------------------- | ---------------------------------------------------- |
| `provider-reliability-diagnostics-and-reporting.md` | `diagnostics-and-debuggability-v2.md` (then archive) |
| `discord-presence-and-media-track-polish.md`        | `presence-integrations.md`                           |
| `provider-fallback-resolver-engine.md`              | `provider-hardening.md`                              |

Full file-by-file table: see the docs truth plan Appendix A in `.cursor/plans/docs_truth_and_ux_848b2de1.plan.md`.
