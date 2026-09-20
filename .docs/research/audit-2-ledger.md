---
status: draft
lastReviewed: "2026-09-20"
---

# Second Full-Tree Audit — Coverage Ledger

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Base: `main@51f19b633` (post-PR #398). Date: 2026-09-17. Session: ses_f54e1f770ffe8dUt9ULLL771qS.

Method: package-by-package and platform-by-platform sweeps via parallel read-only subagents, each returning findings in the playbook format (evidence file:line, impact, effort, risk, confidence, fix sketch). Every headline finding is re-verified against source before it lands in the report. Findings already owned by `.plans/` or open PRs are recorded as tracked, not re-reported.

## Sweep plan and status

| Sweep | Scope | Status |
|---|---|---|
| S1 | `packages/` — storage, core, relay, config, schemas, types, design | done — 2 findings |
| S2 | `packages/providers` — every production provider + adapters | done — 5 findings |
| S3 | `apps/cli/src/app` + `app-shell` (UI, workflows, keybindings) | done — 7 findings |
| S4 | `apps/cli/src/services` (playback, download, cache, sync, presence, update, analytics) | done — 4 findings |
| S5 | `apps/cli/src/domain` + `infra` (policy, mpv, player, fs, abort, work) | done — 1 finding (subtitle attachment cycle staleness); omissions: share, catalog, session, offline, analytics, build, image routing, full redaction sinks |
| S6 | Distribution: install.sh, install.ps1, scripts/, CI workflows, packaging, apps/relay-server, apps/analytics-ingest | running (retry after provider failure) |
| S7 | Cross-cutting: entry points, lanes, platform branches, flags, cancellation, error paths | done — 4 findings + per-seam verdicts |

## Platform coverage

| Platform | What ran | What did not |
|---|---|---|
| Linux | local test suites (storage, playlists, docs) | — |
| macOS | CI parity job (per PR) | local execution |
| Windows | CI parity job (per PR) | local execution |

## Findings

_(to be appended as sweeps return)_
