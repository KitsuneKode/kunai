# Codebase Coherence And Redundancy Sweep

Status: Implemented 2026-05-17
Owner: next autonomous implementation agent
Created: 2026-05-17

> **For agentic workers:** this pass landed on 2026-05-17. Read
> [.plans/codebase-coherence-and-redundancy-report.md](./codebase-coherence-and-redundancy-report.md)
> for audited surfaces, fixed contradictions, and deferred architecture work.

## Goal

Make Kunai easier to understand, maintain, debug, and hand off by reconciling docs, plans, README copy, package metadata, tests, naming, and low-risk redundant code with the current implementation.

## Operating Rules

- Code is the source of truth when docs or plans disagree.
- Keep live provider and Discord checks opt-in.
- Do not delete historical context unless it is replaced, marked historical, or proven irrelevant.
- Do not perform risky architecture refactors in this pass.
- Rename or remove code only when the blast radius is small, typecheck/search proves it safe, and tests cover the area.
- Leave unrelated user edits untouched.

## Audit Depth

### 1. Planning And Roadmap Truth

Audit:

- `.plans/roadmap.md`
- `.plans/plan-implementation-truth.md`
- active `.plans/*.md`
- recently completed implementation plans

Required outcomes:

- Active plans have accurate status.
- Completed checklist items are marked completed or moved to completed sections.
- Superseded plans link to their replacement.
- Historical plans say they are historical instead of looking actionable.
- Roadmap stays short and points to canonical detailed plans.

Acceptance:

- A future agent can tell what is active, done, superseded, or parked without reading every old plan.

### 2. README And User-Facing Accuracy

Audit `README.md` against current code and scripts.

Verify:

- install and run commands
- playback controls
- command palette entries
- provider list and provider language claims
- Discord Rich Presence behavior and privacy
- downloads/offline/library claims
- diagnostics/export claims
- release/provider limitations and legal/product caveats

Required outcomes:

- Remove or soften aspirational claims that are not implemented.
- Keep product copy honest and specific.
- Link to deeper docs rather than duplicating long architecture explanations.

Acceptance:

- A new user can install, run, configure presence, understand providers, and know what is unsupported without stale promises.

### 3. Agent Context And Docs Hygiene

Audit:

- `AGENTS.md`
- `.docs/*.md`
- provider dossiers
- live smoke docs
- testing/release docs
- package-level READMEs if present

Required outcomes:

- `AGENTS.md` remains routing, topology, commands, and expensive-to-rediscover constraints.
- Long explanations move to `.docs/*` or are linked instead of repeated.
- Release gate, live provider smoke, Discord smoke, and deterministic testing policy have one canonical source each.
- Provider docs distinguish production modules, legacy references, and experiment scratchpads.
- Diagnostics docs define what to record and what to redact.

Acceptance:

- Agents load less duplicated context and are routed to the right doc for the task.

### 4. Script And Verification Coherence

Audit:

- root `package.json`
- `apps/cli/package.json`
- `.github/workflows/*`
- `.husky/*`
- `.docs/testing-strategy.md`
- `.docs/release-reliability-gate.md`

Required outcomes:

- All documented commands exist.
- Routine automation stays deterministic.
- Live provider/Discord scripts remain manual or opt-in.
- `pkg:check` and `release:dry-run` are described accurately.

Acceptance:

- No doc claims a script runs checks it does not run.
- No default script unexpectedly hits provider networks or Discord.

### 5. Boundary And Naming Audit

Audit names and module ownership against `.docs/runtime-boundary-map.md`.

Look for:

- pure decision modules named like stateful controllers
- services doing raw infra work
- infra modules owning user-facing policy
- provider-specific conditionals leaking into app-shell code
- duplicated command or picker behavior outside canonical registries
- stale compatibility wrappers

Allowed fixes:

- low-risk file/function renames with local imports and tests
- comments that clarify temporary seams
- docs updates that explain why a seam remains

Deferred fixes:

- large `PersistentMpvSession` extractions
- provider package migrations
- storage model migrations
- shell reducer rewrites
- daemon/web/desktop architecture changes

Acceptance:

- The final report lists concrete follow-up refactors with scope and risk instead of burying them inside this sweep.

### 6. Redundant Code And Legacy Path Audit

Audit:

- `archive/legacy`
- `apps/experiments`
- temporary wrappers
- stale TODO/FIXME comments
- old JSON storage paths
- duplicate helpers
- unused exports

Allowed fixes:

- remove clearly unused dead code
- mark legacy/reference material as historical
- update comments that contradict current behavior
- consolidate duplicated docs into canonical links

Required checks before deletion:

- `rg` proves no active import
- typecheck passes
- test coverage exists or behavior is docs-only
- provider parity/debugging value is considered

Acceptance:

- Removed items are either provably unused or replaced by a canonical source.

### 7. Debuggability And Data-Flow Documentation

Create or update a short practical debugging map.

Must cover:

- playback lifecycle and mpv IPC
- provider resolution and fallback
- presence/Rich Presence
- storage/cache/history
- diagnostics event flow
- where to inspect logs and exported reports
- privacy/redaction boundaries

Acceptance:

- A future agent can start debugging the right subsystem without scanning the whole repo first.

## Suggested Audit Commands

```sh
rg -n "TODO|FIXME|deprecated|legacy|superseded|not implemented|planned|soon|future|manual|live|Discord|provider|mpv|release gate" README.md AGENTS.md .docs .plans apps packages
rg -n "test:live|release:dry-run|pkg:check|fmt|lint|typecheck|build" package.json apps/cli/package.json .github .husky .docs README.md AGENTS.md
rg -n "archive/legacy|apps/experiments|scratchpads" apps packages .docs .plans README.md AGENTS.md
rg -n "from ['\"].*(archive/legacy|apps/experiments)|import .*archive/legacy|import .*apps/experiments" apps packages
rg -n "catch \\{\\}|catch\\(\\(\\) => \\{\\}\\)|void .*\\(|unref\\(|detached" apps/cli/src packages
```

## Required Deliverable

Create or update one report:

```text
.plans/codebase-coherence-and-redundancy-report.md
```

The report must include:

- audited surfaces
- changes made
- contradictions fixed
- docs marked historical or superseded
- code removed or renamed
- findings deferred with reason
- next recommended sweep

## Verification

Required before commit:

```sh
bun run fmt
bun run lint
bun run test
bun run typecheck
bun run build
```

Run if package metadata or release/export behavior changed:

```sh
bun run pkg:check
```

Do not run by default:

```sh
bun run test:live:providers
KUNAI_LIVE_DISCORD_PRESENCE=1 bun run test:live:discord
```

## Commit

Commit after successful verification:

```sh
git add <only files changed by this sweep>
git commit -m "docs: reconcile codebase plans and reliability docs"
```

## Final Report Requirements

Report:

- commit hash
- changed files grouped by docs, plans, code cleanup, tests
- stale docs removed or marked historical
- contradictions fixed
- live checks intentionally not run
- deterministic verification results
- remaining architecture follow-ups
