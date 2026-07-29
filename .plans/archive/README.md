# `.plans/archive/` — landed, superseded, and one-shot plans

Nothing here is active work. These plans shipped, were superseded, or were
written for a single session that has ended.

**Do not route agents here, and do not resume a plan from this folder.** A plan
whose core landed is history, not a queue. If you find remaining work described
in an archived plan, verify it against the code first, then add it to
[`../roadmap.md`](../roadmap.md) or open an issue — do not revive the file.

## Why a file ends up here

| Reason                   | Signal                                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| Core work landed         | `Status: implemented / completed / landed / executed`                      |
| Explicitly superseded    | `Status: superseded`, or a newer plan took over the subject                |
| Session-scoped           | `HANDOFF-*`, agent prompt packs, parallel-agent briefs                     |
| Dated audit or report    | A verdict was recorded; the verdict is not a plan                          |
| Vision / strategy essays | `v1-strategy-*`, `v2-*`, `v3-*`, `execution-playbook`, cache/backend hunts |

## Clusters worth knowing about

- **Sakura theme migration** — `sakura-*` (7 files). The token/theme foundation
  landed; only the remaining rollout slices stayed active as
  [`../sakura-rollout.md`](../sakura-rollout.md).
- **Superpowers-style execution plans** — the files opening with
  _"For agentic workers: REQUIRED SUB-SKILL"_. Same genre as
  `docs/superpowers/plans/`; kept for the reasoning, not the checklists.
- **Provider engine chain** — `provider-contract-v2`, `provider-fallback-resolver-engine`,
  `provider-engine-behavior-*`, `provider-ui-projection-contract`. The shipped
  contract now lives in `packages/core` and [`../../.docs/providers.md`](../../.docs/providers.md).
- **`plan-implementation-truth.md`** — an 81 KB index that adjudicated
  plan-vs-code drift across 143 flat plan files. That job is gone: the active
  folder now holds only unfinished work and this folder holds only history.
  Kept for its verified capability tables, which record where features actually
  landed.
- **`architecture-improvement-2026-06-22/`, `workboards/`** — completed
  numbered workboards.

## Rule going forward

When a plan's core work lands, move it here **in the same change set** and put
any residual work on the roadmap as one line. That is what keeps the active
folder small enough to actually read.
