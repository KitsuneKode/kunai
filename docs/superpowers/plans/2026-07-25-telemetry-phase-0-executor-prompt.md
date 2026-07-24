# Executor prompt — Telemetry Phase 0

Paste the block below to the executing agent. It is written to be self-contained:
the agent needs no prior context from the design conversation.

Run it **once per task**, changing only the task number on the `TASK:` line. Between
tasks, hand the agent's report back to the reviewing agent for verification.

---

```
You are implementing one task from a written implementation plan. The plan is
complete and final — it was written by someone with all the relevant files open.
Your job is to execute it exactly, not to improve it.

REPO: /home/kitsunekode/Projects/hacking/kitsunesnipe
PLAN: docs/superpowers/plans/2026-07-25-telemetry-phase-0-correctness.md
TASK: 1          <-- change this number for each run

WHAT THIS CHANGE IS
Kunai has an opt-in anonymous telemetry ping. Phase 0 fixes three defects in it:
  1. The ingest server accepts any string as `version`, `os`, and `arch`. These are
     aggregation keys, so a junk value corrupts a whole dimension of published data.
  2. A failed daily ping is lost permanently, because the client marks the ping as
     sent BEFORE making the network call.
  3. The public metrics endpoint has no `stale-while-revalidate`, so every CDN cache
     expiry stampedes the origin.
No wire format changes. No config migration. Old clients keep working.

BEFORE YOU START
1. Read the WHOLE plan file top to bottom — not only your task. The "Executor
   Protocol" section is binding and overrides your own judgement wherever they
   disagree. Read it twice.
2. Read the "Global Constraints" section. Every task inherits it.
3. Confirm you are on a clean tree:
     cd "$(git rev-parse --show-toplevel)" && git status --short
   If there are unexpected modified files, STOP and report before touching anything.

HOW TO EXECUTE
Work through your task's steps in order, one at a time. Each step is 2-5 minutes.
The cycle is: write the failing test -> run it and WATCH IT FAIL -> write the
implementation -> run it and watch it pass -> commit.

Step 2 (watching it fail) is mandatory and is not a formality. If the test passes
before you have written the implementation, the test is broken — fix the test, do
not proceed. If it fails for a reason other than the one the plan predicts (a typo,
a wrong import path, a syntax error), fix that and re-run until the failure matches
what the plan says to expect.

Every bash command must start from a known directory, because `cd` persists between
commands:
     cd "$(git rev-parse --show-toplevel)" && <command>
For per-file test runs inside an app:
     cd "$(git rev-parse --show-toplevel)/apps/telemetry-ingest" && bun test <path>

RULES YOU MUST NOT BREAK
- Write exactly the code shown in the plan. Do not rename, refactor, reorder, add
  error handling, add logging, or add comments beyond those shown. If the plan's
  code looks wrong to you, STOP and report it — do not silently correct it.
- Do not touch any file not listed in your task's "Files" block.
- Do not modify TELEMETRY_PAYLOAD_KEYS. It must stay exactly
  ["arch", "installId", "os", "ts", "version"].
- Do not add a retry loop, setTimeout backoff, or sleep to TelemetryService. The
  retry works by persisting a marker that the NEXT process launch reads. That is
  deliberate and is the whole point of Task 5.
- Do not add any console.*, logger call, or thrown error to TelemetryService.
  Telemetry failures must stay completely silent.
- Bun only. Never npm, npx, node, yarn, or pnpm.
- Never run bare `bun test` from the repo root.
- Do not run `bun run fmt` unless you are on Task 6.
- Do not `git add -A` unless you are on Task 6. Stage only your task's files.

IF A PRE-EXISTING TEST FAILS
STOP IMMEDIATELY. Do not edit the failing test to make it pass. Report the test
name, its file and line, and the assertion message, then wait.
The single exception: during Task 4, `bun tsc --noEmit` may fail because some file
builds a KitsuneConfig object literal without spreading DEFAULT_CONFIG. Add
`telemetryRetryAfter: 0` to that literal and continue. This exception is for
typecheck errors only — never for failing tests.

NEVER CLAIM A STEP IS DONE WITHOUT RUNNING IT
Do not tick a checkbox based on what you expect the result to be. Run the command,
read the output, then tick it. If you did not run it, it is not done.

WHEN YOU FINISH THE TASK, REPORT
  1. Task number and name.
  2. The exact failure message you saw at Step 2.
  3. The pass output at Step 4, including the test count.
  4. The commit SHA: cd "$(git rev-parse --show-toplevel)" && git log --oneline -1
  5. Anything at all that did not match the plan, however small.
  6. `git status --short` output, to prove no stray files were touched.

Then STOP. Do not start the next task. A reviewer verifies your work first.

If you are blocked at any point, stop and report the blocker. Never improvise a
workaround, and never skip ahead.
```

---

## Verification checklist for the reviewing agent

Run after each task report. Do not take the executor's report at face value —
confirm from the repository itself.

**After every task**

```bash
cd "$(git rev-parse --show-toplevel)"
git log --oneline -1
git show --stat HEAD
git status --short
```

- Files changed match the task's **Files** block exactly — no extras.
- Commit message matches the plan verbatim.
- Working tree is clean.

**After Task 2** — the tightening actually tightens, and nothing widened:

```bash
cd "$(git rev-parse --show-toplevel)"
grep -n "TELEMETRY_PAYLOAD_KEYS" apps/telemetry-ingest/src/ingest.ts
grep -n "length > 64\|length > 32" apps/telemetry-ingest/src/ingest.ts
cd apps/telemetry-ingest && bun test test
```

The key list must be unchanged, the old length checks must be gone, and the full
`apps/telemetry-ingest` suite must be green — including every test that predates
this work.

**After Task 5** — the prohibited shapes are genuinely absent:

```bash
cd "$(git rev-parse --show-toplevel)"
grep -n "setTimeout\|console\.\|logger" apps/cli/src/services/telemetry/TelemetryService.ts
```

The only `setTimeout` permitted is the pre-existing abort timer inside `send()`. Any
other timer, or any logging call, means the executor invented a retry loop and the
task must be rejected.

Then confirm persistence happens exactly once, after the outcome is known:

```bash
grep -n "config.update" apps/cli/src/services/telemetry/TelemetryService.ts
```

Inside `maybePing` there must be exactly one `config.update` call for the send path.
If a second one appears before the `send()` call, the original bug survived.

**After Task 6** — full repo:

```bash
cd "$(git rev-parse --show-toplevel)"
bun run typecheck && bun run lint && bun run test
```

Then walk the plan's own **Verification** section item by item.

## If the executor goes off-plan

The most likely failure modes, and what to do:

| Symptom                                            | Cause                                                               | Action                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Task 2 commit also edits a pre-existing test       | It "fixed" a test the tightening broke                              | Revert the commit. That test failing is real signal — investigate why before redoing. |
| `setTimeout` backoff appears in `TelemetryService` | It implemented the retry the obvious way instead of the planned way | Reject Task 5 and re-run it with the "no retry loop" rule quoted back to it.          |
| Checkboxes ticked but no commit exists             | It reported without running                                         | Re-run the whole task on a fresh agent.                                               |
| Files outside the task's Files block changed       | Ran `bun run fmt` early, or `git add -A`                            | Reset, re-run the task, restate the staging rule.                                     |
| `TELEMETRY_PAYLOAD_KEYS` changed                   | It confused tightening values with adding keys                      | Reject. This breaks the wire contract for every existing client.                      |
