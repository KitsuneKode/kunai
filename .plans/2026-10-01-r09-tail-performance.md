# R09 — Measure tail latency, bound resources and simplify proven hotspots

Status: MEASUREMENT READY; OPTIMIZATION WAITING FOR CORRECTNESS; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Establish reproducible performance evidence, repair measured slow paths, and keep new code smaller in responsibility.
**Architecture:** Reuse startup/playback diagnostics; benchmark complete user operations and repository boundaries; runtime owners optimize their paths behind current interfaces. No new telemetry platform or generalized framework.
**Tech stack:** Bun/TypeScript, monotonic clocks, CLI/PTY drivers, SQLite fixtures, process/resource sampling.
**Spec:** [060 startup owner](./060-first-paint-profile.md), [008 timer/poster owner](./008-tui-timer-and-poster-perf.md), [boundary design](./boundary-hardening-and-adaptive-downloads.md), [runtime map](../.docs/runtime-boundary-map.md).
**Dependencies:** Baseline capture independent. Optimization follows R01–R08 correctness. Coordinator owns new scripts/exported diagnostics.

## Review focus

1. Measure intent→usable result, including queue delay and failures; no success-only p99.
2. Report sample counts, population, hardware/runtime/cache state, timeout counts and uncertainty.
3. Startup deferral preserves explicit analytics consent and graphics/dependency prerequisites.
4. Download/UI resource use stays bounded at configured concurrency and large library sizes.
5. Extractions remove duplicated invariants and reduce caller knowledge without proliferating facades/packages.

## R09.1 — Baseline and benchmark contracts

Allowed edits: `apps/cli/src/services/diagnostics/cli-startup-milestone.ts`, `apps/cli/src/services/playback/playback-startup-timeline.ts`, existing diagnostics tests; create `scripts/bench-kunai-reliability.ts` and `apps/cli/test/unit/scripts/bench-kunai-reliability.test.ts`. Reuse 060 measurement work; its three-run medians are exploratory, not p99.

- [ ] Inventory actual milestones and readers. Record shell usable/input attached rather than only module imported; playback starts at user intent and ends at confirmed mpv progress, not URL resolution/spawn.
- [ ] Use a monotonic operation start/time source. Keep diagnostic fields local/redacted; do not add events or payload fields to analytics without its separate contract.
- [ ] Define benchmark scenarios startup, filter, offline-lookup, queue-eligibility and playback-cancel. The script supports --scenario, --samples, --output and validates them before touching data; every run creates a private profile.
- [ ] Offline fixture sizes: 100, 1k and 10k assets, multiple profiles and missing sidecars. Queue fixture: 50 deferred+due row, two workers and configured 1–5 concurrency. Startup: fresh and warm profile, with/without graphics, offline network and a large shadow history.
- [ ] Capture raw observations as NDJSON with scenario, durationMs, outcome, fixtureSize, runtime/platform, tested SHA/diff hash and resource observations. Public artifacts omit paths/titles/tokens.
- [ ] Define percentile calculation deterministically:

```ts
function nearestRank(values: readonly number[], q: number): number {
  if (values.length === 0 || !Number.isFinite(q) || q <= 0 || q > 1) {
    throw new Error("Nonempty samples and 0 < q <= 1 required");
  }
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error("Durations must be finite and nonnegative");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.ceil(q * sorted.length) - 1];
  if (value === undefined) throw new Error("Quantile index is out of bounds");
  return value;
}
```

Test empty/invalid inputs, ties, known quantiles and no mutation of the caller's array. This is observed nearest-rank p99, not an inference about all future runs.

- [ ] Cheap local scenarios require at least 1,000 observations per declared population. Startup begins with 200 exploratory launches and reports tail samples/counts; collect more before an SLO claim. Report provider/live latency separately by provider/operation, with exact small sample counts; never call ten live requests production p99.
- [ ] Schedule offered work independently when testing load, recording waiting time. A generator that stops producing while the system stalls hides overload. Include failures/timeouts with observed duration and failure rate; timeouts are censored completion, not successful latency. [Histogram measurement guidance](https://github.com/HdrHistogram/HdrHistogram#readme).

## R09.2 — Proposed budgets and optimization

These are initial engineering targets for a documented reference machine, **not measured current results or universal guarantees**. Recalibrate explicitly from baseline and supported hardware, preserving the regression direction.

| Operation/population            | Initial target                    | Correctness guard                                        |
| ------------------------------- | --------------------------------- | -------------------------------------------------------- |
| Warm CLI usable shell           | p95 ≤1 s; p99 ≤2 s                | input attached, analytics off unless explicitly opted in |
| Local filter key→visible rows   | p95 ≤100 ms; p99 ≤200 ms          | exact typed query, no action leakage                     |
| Local resume→confirmed progress | p95 ≤2 s; p99 ≤3 s                | selected artifact and position, no network               |
| Indexed lookup in 10k assets    | p95 ≤50 ms; p99 ≤150 ms           | profile/native identity exact                            |
| User cancel→settled child work  | hard maximum 15 s                 | ownership cleanup, no late state mutation                |
| Online resolve/start            | provider-specific measured budget | one bounded deadline, explicit failure fraction          |

- [ ] Profile the highest miss before editing. Attribute graphics/dependency probing, synchronous SQLite/import work, provider resolve/probe, player readiness and shell render separately.
- [ ] Startup changes belong to existing startup owner: defer optional work until after usable first paint, keep terminal capability detection before affected rendering and consent before any analytics send/identity. No fire-and-forget promises without error/cancel ownership.
- [ ] Apply R04 indexed queries rather than loading entire libraries. Debounce/coalesce only operations that preserve latest intent and cancellation; don't conceal queue waiting in the metric.
- [ ] Finish 008's remaining timer/poster coupling using characterization tests. Isolate per-job updates from root shell redraw where measured; confirm narrow-terminal/poster correctness before/after.
- [ ] Measure downloads at 1–5 workers: aggregate fragments, socket/CPU/RSS, event-loop delay, progress render count and cancellation. Preserve total capacity bounds; no blanket retry/concurrency increase.
- [ ] Compare identical fixtures/reference machine at parent and candidate. Store raw samples and summarize effect size/failures. No production performance assertion from fixture speed alone.

## R09.3 — Maintainability and deslop gates

Existing architecture plans 010–015 remain owners; reconcile their current paths/status before extraction. Allowed runtime edits are assigned to the owning packet, never performed concurrently by the benchmark owner.

- [ ] For every added class/helper/package, identify invariant, consumers, lifecycle owner and visible failure result. Prefer pure policy functions for decisions, classes for owned state/lifecycle, and ports for genuine runtime variation.
- [ ] Extract one stable responsibility at a time from PlaybackPhase, shell workflows, Ink shell or DownloadService after behavior tests. Keep app policy out of storage/provider/infra and Ink out of domain/services.
- [ ] Consolidate repeated recovery budgets, profile normalization and provider descriptors only where they mean the same thing. Distinct stream cache purposes and platform transport mechanics may remain distinct.
- [ ] Remove unreachable capability flags, pass-through facade layers and unused speculative maintenance hooks after tracing readers/exported consumers/roadmap. Every remaining flag needs a reader and enable/disable/readback test.
- [ ] Capture before/after call graph, duplicated branches removed, owned interfaces and test runtime. Do not use arbitrary line count or number of packages as the architecture objective.
- [ ] Add comments/docs for non-obvious ownership/failure decisions and examples for new public interfaces. Avoid restating code in comments or generating a second standards document.

## Verification and closure

After implementing the benchmark, commands are:

```sh
bun run --cwd apps/cli test:file -- test/unit/scripts/bench-kunai-reliability.test.ts
bun run scripts/bench-kunai-reliability.ts --scenario offline-lookup --samples 1000 --output /tmp/kunai-r09-offline.ndjson
bun run scripts/bench-kunai-reliability.ts --scenario filter --samples 1000 --output /tmp/kunai-r09-filter.ndjson
bun run scripts/bench-kunai-reliability.ts --scenario startup --samples 200 --output /tmp/kunai-r09-startup.ndjson
bun run --cwd apps/cli typecheck
```

Run all defined scenarios and affected-owner regressions; runbook gates follow any complete feature. Extend 060 with population/tail results while retaining its original measurement scope. Return raw data, reference environment, p50/p95/p99/max, error/timeout denominator, resource bounds and actual optimization evidence. Unmeasured populations stay unqualified.
