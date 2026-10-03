# October 3 production review evidence

This is reference material, never imported by production runtime.

The repair candidate is based on main `e509732e7cdd3277943b7a705a0fea9004ed0b7f`.
Main remained at that SHA at the later read. The original audit was local-only.
The user subsequently authorized commits/PRs; mobile PR #554 is now open. No
issue, trust configuration, release, registry, deployment or live profile was modified.

- Original inventory: `prs.json`, `pr-details.json`, `issues.json`,
  `pr-diffs.json` — 41 open PRs / 22 issues with base/head OIDs.
- Later inventory: `refresh/` — changed existing PR metadata and patches,
  six new PRs, all 29 open issue bodies, and selected failed-job excerpts.
  Ten previously reviewed PR heads changed; unchanged originals retain their
  original exact OIDs. Counts and dispositions are a snapshot, not ongoing
  synchronization with GitHub.
- `reproductions/` — controlled mocked-fetch and temporary-file regressions,
  plus a bounded child-process signal-order demonstration. Original logs are
  historical; `pr540-refreshed-result.txt` tests refreshed head `4093fcfeea`.
  It has eleven control passes and three failures: two DNS checks and foreign
  JSON preservation. These demonstrate API flow and local data loss, not
  packets sent to a private target or exploitation of production.
- `react-diagnostics.json` — full React Doctor 0.9.14 baseline;
  `react-diagnostics-final-changed.json` — final new-diagnostic comparison to
  HEAD at scan time (baseline `e509732e7c`), complete for eligible changed files in both CLI and docs. Scopes differ
  and counts are not a whole-project before/after score. Telemetry/scoring was
  disabled. Final changed scope has zero errors and three advisory warnings.
- `dependency-audit.json` — current full lockfile advisory; development-only
  dependency paths do not make the audit clean or justify hiding the alert.
- `startup-measurements.json` — seven warm process-to-help-exit samples per
  entrypoint with isolated storage. No claim of first-video or TUI speedup.
- [verification.md](verification.md) — commands, results, skips and artifact
  checks, with bounded evidence excerpts and hashes of full temporary logs.

Review and remaining work: [production review](../../../.plans/2026-10-03-production-review.md).
The original workspace's unrelated dirty work was preserved in place.
