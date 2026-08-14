# Provider Recovery And PR Triage

**Status:** Executed on main — awaiting staff review (2026-07-11)

**Owner:** Coordinator agent

**Goal:** Restore a release-worthy provider baseline, retire stale draft work safely, and
make provider health observable without putting live network volatility in the default test path.

## Baseline (2026-07-11)

| Provider   | Lane    | Live result                                   | Current disposition                    |
| ---------- | ------- | --------------------------------------------- | -------------------------------------- |
| YouTube    | youtube | Pass: direct stream resolved                  | Keep enabled                           |
| Rivestream | series  | Pass: two stream candidates                   | Keep enabled                           |
| AllAnime   | anime   | Pass: three stream candidates                 | Keep enabled; preserve ani-cli parity  |
| Videasy    | series  | Fail: `mb-flix` returns HTTP 404              | Investigate before default/release use |
| Miruro     | anime   | Fail: pipe API network request cannot connect | Investigate before default/release use |

The live matrix is opt-in. Its result is release evidence, not a default-CI gate.

## Non-Negotiable Rules

1. Read `.docs/provider-intake.md`, `.docs/providers.md`, and `.docs/testing-strategy.md`
   before touching provider code.
2. Use `container.engine.resolve(...)` for live proof. Do not claim success from a helper
   or a direct HTTP probe that bypasses the real engine.
3. Keep provider research evidence redacted: no cookies, session tokens, signed stream URLs,
   or local profile paths in durable documents.
4. Keep provider lanes isolated. Anime-only modules must not resolve series/YouTube inputs;
   YouTube state must not leak into anime or series selection/history.
5. Do not merge the stacked AD11 PRs as a bundle. Reimplement a narrowly verified idea on
   current `main` only when its current owner and regression surface are understood.
6. Default tests must stay deterministic. Network behavior belongs in fixtures plus opt-in
   live smoke checks.

## Workstreams

### A. PR Curator (read-only first)

**Scope:** PRs #5 through #15 and their remote branches.

**Deliverable:** A one-page disposition table with each PR/branch marked `close`, `archive`,
`selective candidate`, or `already superseded`, including the current owner file and proof
required for every selective candidate.

**Method:**

1. Compare each unique commit against current `main`, not the PR's merge base.
2. Reject broad overlay, playback, diagnostics, and provider bundles that reintroduce older
   root-content authority or duplicate current services.
3. Extract only small ideas with a present-day owner and a deterministic regression test.
4. Verify PR checks and branch ancestry before closing anything.
5. Treat the release branch separately: no release promotion while a default provider lane is
   knowingly unhealthy.

**Do not edit:** provider adapters, `PlaybackPhase.ts`, root-content ownership, or CI.

**Exit gate:** A coordinator can close/archive stale drafts with a short explanation, and has
an explicit list of any remaining follow-up slices.

### B. Videasy Research Agent (dossier only)

**Scope:** `packages/providers/src/videasy/*`, existing live smoke, local experiments, and
the current `mb-flix` 404.

**Deliverable:** Update `.docs/provider-dossiers/videasy.md` with a current, redacted dossier:
known working endpoints, broken endpoint/response evidence, two series fixtures, header/runtime
requirements, fallback candidates, and a recommended disposition.

**Method:**

1. Reproduce through `container.engine.resolve(...)` using an isolated profile.
2. Trace the failing `mb-flix` request through the provider's actual candidate chain.
3. Compare direct URL construction, endpoint health policy, and source fallback behavior.
4. Distinguish upstream 404, invalid title mapping, and client parsing failure.
5. Record only reusable fixture data; redact volatile stream material.

**Do not edit:** production provider code. Research should end with one of: `repair`,
`demote from default`, or `disable/quarantine`.

**Exit gate:** Dossier contains enough evidence for a separate implementation agent to make one
bounded change without redoing discovery.

### C. Miruro Research Agent (dossier only)

**Scope:** `packages/providers/src/miruro/*`, active mirror order, pipe request path, and the
current connection failure.

**Deliverable:** Update `.docs/provider-dossiers/miruro.md` with mirror reachability, pipe
response behavior, episode/source evidence for sub and dub, and an explicit distinction between
local connectivity failure and provider-side drift.

**Method:**

1. Reproduce with `container.engine.resolve(...)` and the One Piece fixture.
2. Exercise each permitted Miruro mirror deliberately; collect failure class and timing only.
3. Verify whether the failure is DNS, TLS, host blocking, API contract drift, or a bad pipe key.
4. Check the existing provider-key/source-cycling fixtures before proposing code changes.

**Do not edit:** production provider code or unrelated AllAnime behavior.

**Exit gate:** Evidence supports either a minimal mirror/order change, a fixture-driven parser
repair, or a documented environment/provider outage with no source change.

### D. Provider Repair Agent (runs after B/C decisions)

**Scope:** One provider per branch/commit. Start with the provider that has a repairable,
evidence-backed cause.

**Deliverable:** A narrow implementation plus deterministic fixture/contract tests, updated
dossier/docs, and one opt-in live smoke result.

**Required proof:**

- provider module unit tests for the drifted parsing/routing rule;
- real engine smoke with `isolatedProfile: true`;
- provider failure/diagnostics remain actionable when the upstream is unavailable;
- no lane crossing in provider selection, history, or playback handoff;
- `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run test`, and `bun run build`.

**Decision rule:** If upstream behavior is not repairable within the supported direct-runtime
contract, remove it from automatic/default fallback before release rather than disguising failure
as a healthy option.

### E. Health Automation Agent (after the matrix is stable)

**Scope:** `apps/cli/test/live/provider-matrix.smoke.mjs`, GitHub workflow configuration, and
live-test documentation only.

**Deliverable:** A manually dispatched or scheduled, non-blocking workflow that stores redacted
matrix JSON as an artifact and summarizes provider state without failing normal PR CI.

**Constraints:**

- no shared relay URL or credentials;
- matrix runs serially with its current per-provider deadline;
- retain individual provider selection for incident response;
- workflow result must distinguish `healthy`, `provider-drift`, `environment-network`, and
  `harness-failure`.

**Exit gate:** An operator can inspect one artifact and identify provider/lane, fixture,
failure code, runtime, and timestamp without reading logs manually.

### F. Shell Reliability Agent (independent, low priority)

**Scope:** root overlays, mounted browse/post-play content, and timer/input behavior.

**Deliverable:** A small current-main proposal for pausing background visual work under a
root-owned overlay, with render-capture and `simulateTicks` coverage.

**Do not reuse:** the AD11 root overlay implementation wholesale. Current root-content ownership
is the authority.

**Exit gate:** No duplicate input handling, no background calendar/status tick while obscured,
and captures stay correct at 72/100/140 columns.

## Merge And Execution Order

1. Coordinator publishes PR disposition and protects `main` from the stacked PR merge.
2. B and C research run in parallel; F may run in parallel because it owns separate files.
3. Coordinator chooses `repair`, `demote`, or `quarantine` for each provider from dossiers.
4. D implements one provider at a time, beginning with the clearer repair.
5. E adds health automation only after matrix semantics and classifications are settled.
6. Re-run release evidence; then close stale PRs and reassess the release branch.

## Release Gate

Do not promote a release until:

- series has at least one healthy default path (currently Rivestream);
- anime has at least one healthy default path (currently AllAnime);
- YouTube remains healthy;
- Videasy and Miruro are either repaired and proven, or demoted/quarantined with accurate UI and
  diagnostics;
- matrix artifact and individual smoke commands agree;
- the deterministic CLI suite and build are green.

## Suggested Agent Prompts

### Videasy research

> Investigate the current Videasy live failure using the provider intake playbook. Do not edit
> production code. Reproduce through `container.engine.resolve(...)`, trace the `mb-flix` 404,
> update the Videasy dossier with redacted evidence and a repair/demote/quarantine recommendation.

### Miruro research

> Investigate Miruro's pipe network failure using the provider intake playbook. Do not edit
> production code. Reproduce through the real engine, classify mirror/network/contract causes,
> update the Miruro dossier with redacted sub/dub evidence and a bounded next-step recommendation.

### PR curator

> Review draft PRs #5-#15 against current main. Produce a disposition table; do not merge broad
> stacks. Identify only narrowly reimplementable ideas with current owner files and deterministic
> test requirements. Verify checks/ancestry before proposing closure.

### Health automation

> Add a non-blocking manual/scheduled provider-matrix workflow after reviewing the live matrix
> contract. Store redacted JSON artifacts, never make normal PR CI depend on live providers, and
> document health classifications and operator usage.
