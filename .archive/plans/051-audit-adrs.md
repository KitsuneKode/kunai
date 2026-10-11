# Plan 051: Write the three audit ADRs — concurrency, side-channel containment, gate trust

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- .docs/adr/ apps/cli/src/main.ts apps/cli/src/services/presence/ apps/cli/src/services/update/native-installer/`
> Mismatch → re-check the cited code still supports each ADR's premise.

Closes #117.

## Status

- **Priority:** P2
- **Effort:** M (mostly writing + verification reads)
- **Risk:** LOW — docs only, but each ADR must state a decision the code is then _made to match_; an ADR that describes aspirational behavior is worse than none
- **Depends on:** none
- **Category:** docs / architecture
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

Four audit passes produced findings that cannot be adjudicated from the code
alone because there is no stated position on three questions: what concurrent
instances may share, which subsystems may never reach the fatal path, and what
makes a gate trustworthy. Each ADR converts a re-litigated question into a
reference. Sequencing per the issue: **gate trust first** (smallest, makes the
other two verifiable), then concurrency and side-channel containment
(independent of each other).

## Current state

- `.docs/adr/` holds `0001-personal-media-vocabulary.md` and
  `0002-browserless-provider-strategy.md` — next numbers are **0003–0005**.
- ADR format (from `0002`): frontmatter `status: current` +
  `lastReviewed: "YYYY-MM-DD"`, title `# NNNN — <decision>`, `> Agent-facing
(L3)` line, then `Status: accepted` / `Date:` / `## Context` /
  `## Decision` sections. Match it.
- `bun run verify:doc-paths` and `bun run verify:doc-frontmatter` gate `.docs/`.

Evidence each ADR must reckon with (all verified on `main`):

**Concurrency (ADR 0003):**

- `packages/storage/src/sqlite.ts` — WAL readers don't block writers;
  corruption quarantine exists.
- `apps/cli/src/services/update/native-installer/version-lock.ts:176` —
  `lockCurrentVersion` does `if (!lock.acquired) return` — a second instance
  silently runs **unprotected** (the one real gap the audit found).
- `cleanup-versions.ts:71-97` — five layers of path protection.
- `claimedJobIds` (download queue) is in-memory per-process while the queue is
  durable and shared — the asymmetry to call out (see #116).
- Shared state to classify: `kunai-data.sqlite`, `kunai-cache.sqlite`, version
  lock, mpv IPC sockets, `claimedJobIds`, sync outbox, `config.json`.

**Side-channel containment (ADR 0004):**

- `main.ts:1124` escalates any `uncaughtException` to fatal shutdown exit 1.
- #94: a malformed Discord IPC frame reached it through an unguarded
  `JSON.parse` in a raw socket callback — a cosmetic integration can kill a
  playback session.
- Best-effort subsystems to name: presence, analytics, update checks,
  recommendations prefetch, artwork.

**Gate trust (ADR 0005):**

- Two fake gates shipped green: `filename-convention.test.ts` populated its
  allowlist by walking the tree it checked (asserted `A ⊆ A`; fixed in #104),
  and the `install.sh` consent test never detaches the controlling TTY so the
  sudo path is never exercised (#95).
- Holed gates: `contract-conformance.test.ts` missed #100/#103/#88;
  `boundary-imports.test.ts` can't see ~5k lines of flat root modules (#109);
  `verify:doc-coverage` doesn't cover command/flag/config coverage (#105).
- `bun run test` reports `N skip` without naming what skipped — pwsh-gated
  installer tests land there invisibly (AGENTS.md hazard #2).

## Commands

| Purpose         | Command                          | Expected |
| --------------- | -------------------------------- | -------- |
| Doc paths       | `bun run verify:doc-paths`       | exit 0   |
| Doc frontmatter | `bun run verify:doc-frontmatter` | exit 0   |
| Doc coverage    | `bun run verify:doc-coverage`    | exit 0   |
| Format          | `bun run fmt`                    | exit 0   |

## Scope

**In scope:**

- `.docs/adr/0003-concurrent-instance-state-ownership.md` (new)
- `.docs/adr/0004-best-effort-side-channel-containment.md` (new)
- `.docs/adr/0005-gate-trustworthiness.md` (new)
- `.plans/roadmap.md` — if the ADRs retire any "unanswered question" language there, update it
- The issue's "make the code match" clause: **only** the one-line fix at `version-lock.ts:176` (log loudly when the lock isn't acquired) may ride along — everything else is follow-up

**Out of scope:**

- Refactoring call sites to enforce ADR-0004's boundary — the ADR states the rule; enforcement is a separate change.
- Closing #109/#105 (the holed-gate issues stay open with their own plans).
- `.docs/agents/` index updates unless it lists ADRs.

## Steps

### Step 1: ADR-0005, gate trustworthiness (write first)

Decide and record: (a) every architecture/policy test ships with evidence of a
deliberate red run — break it, record the failure in the commit message, fix
it; (b) allowlists are static and shrink-only — never self-populating from the
tree under test; (c) test-skip output must name what was skipped (the gate is
responsible for surfacing it). Cite the two fake gates and three holed gates
as the motivating context.

**Verify:** `bun run verify:doc-frontmatter` → exit 0.

### Step 2: ADR-0003, concurrent-instance state ownership

For each piece of shared state listed above, classify: **per-process** /
**safely shared** / **must not be shared**, and what contention does. Then
answer: is a second instance supported, degraded, or refused? The ADR should
land on "degraded, and the degraded paths are named" — matching reality —
unless verification shows otherwise. Include the one code change: make
`lockCurrentVersion`'s unacquired branch log instead of silently returning.

**Verify:** the version-lock log change compiles — `bun run --cwd apps/cli typecheck` → exit 0; ADR + change in one commit.

### Step 3: ADR-0004, best-effort side-channel containment

Decide and record: which subsystems are best-effort (the list above — confirm
each is truly non-essential before writing it), the rule that none may reach
`main.ts`'s fatal `uncaughtException` path, and where the containment boundary
lives — pick one of: per-callback wrapper, supervised-task helper, or
background-scheduler policy. The issue doesn't prescribe; choose the one that
matches how these subsystems are actually launched today (read
`services/presence`, `services/analytics`, `services/update` startup paths
first — the ADR must describe a boundary that exists or can exist at one seam,
not forty call sites).

**Verify:** `bun run verify:doc-paths` → exit 0.

### Step 4: Cross-references + gates

- Each ADR links the motivating issues/PRs (#94, #95, #104, #100, #103, #88, #109, #105, #116) and closes with "Status: accepted".
- If `.docs/agents/` or the roadmap references "unanswered" versions of these questions, update those references.
- Run all doc verifiers + `bun run fmt`.

## Test plan

Docs-only (plus one log line). The "test" is the verifiers — and, per the
ADR-0005 rule you're codifying, demonstrate it on the one code change: revert
the version-lock log temporarily? No — simpler: the change is additive
logging, no behavior gate. State that explicitly in the PR body.

## Done criteria

- [ ] `0003`, `0004`, `0005` exist under `.docs/adr/` with correct frontmatter
- [ ] Each ADR states a _decision_ (not options), names the shared state / subsystems / rules explicitly
- [ ] `version-lock.ts` logs when the lock isn't acquired (one line, in the same PR)
- [ ] `bun run verify:doc-paths`, `verify:doc-frontmatter`, `verify:doc-coverage`, `bun run fmt` all exit 0
- [ ] Issue #117 body re-read before PR submission — every "What the ADR must settle" bullet is answered in the text

## STOP conditions

- Verification shows a subsystem on the best-effort list is actually load-bearing (e.g. update checks gate something real) — report rather than writing a wrong decision.
- The containment-boundary options all require touching >3 files — the ADR should still be written but flag that the boundary doesn't exist yet and name the cheapest seam; do NOT implement a wide refactor under a docs plan.
- An ADR numbered 0003+ already exists on main (drift) — renumber, don't collide.

## Maintenance notes

- ADRs are the anti-re-litigation tool: when the next audit finding hinges on "is this shared?", the ADR should be cited in review.
- The follow-up enforcement work (containment wrapper implementation, gate holes #105/#109) is deliberately not in this plan — it lands easier once the rule is recorded.
