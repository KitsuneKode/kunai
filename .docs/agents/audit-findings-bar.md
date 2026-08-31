---
status: current
lastReviewed: "2026-08-31"
---

# The bar for an audit finding

> Agent-facing (L3). Never linked from published docs.

Four audit passes over this repo produced ~38 distinct claims. Roughly a third
dissolved when someone opened the twenty lines around the cited one. The line
numbers were nearly always right; the inference from them was not.

This file is the bar. Apply it before filing, and when reviewing findings
someone else filed.

## The recurring failure

**A true observation about a line, plus a false inference about what that line
does.** Every refuted finding had this shape:

| Filed as                                                               | What one more hop showed                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| "Empty catch swallows read errors, watchdog stops protecting"          | The catch is inside a template literal that becomes Worker source, and the fallback is a valid RSS reading |
| "N+1 fan-out: dozens of concurrent TMDB calls for long-running series" | The list is filtered to seasons with _no air date_; One Piece exits before the `Promise.all`               |
| "Naming regressions would pass — `Frieren - E03.mp4` is untested"      | That exact string is asserted in `download-service.test.ts:65`                                             |
| "crypto-js on the hot decrypt path in `vidrock/direct.ts:2050`"        | That file is 124 lines and already uses `node:crypto`; a test pins the migration                           |
| "`NUL.mp4` bypasses the reserved-name guard"                           | Sanitisation runs on the bare title, before an extension exists                                            |
| "Config save failures are swallowed"                                   | A test named "store rejection rejects both save() and flushPending()"                                      |

## Six rules

1. **Read the callee, not the call site.** If a finding depends on what a
   predicate admits, a helper returns, or a constant holds — open it. Two of the
   refutations above died on the function one hop away.

2. **Grep the test file before claiming something is untested.** Cheapest check
   available, and three findings would not have been filed.

3. **An empty `catch` is a finding only if it is undefended.** Quote the comment
   above it, or state there isn't one. This codebase comments its deliberate
   silences — `memory-watchdog.ts:72`, `atomic-write.ts:135`,
   `ConfigServiceImpl.ts:758` all carry their rationale.

4. **State the disproof you attempted.** Not a confidence label — _what did you
   check that would have made this wrong?_ Across four passes, stated confidence
   had no relationship to whether a finding survived: a HIGH-confidence item
   cited line 2050 of a 124-line file. Treat the label as noise; read the
   evidence.

5. **Check `.plans/roadmap.md` before filing anything architectural.** Four
   findings in one pass restated plans 010/011/012/014/015, which are already
   written, prioritised, and dependency-ordered with a stated reason for being
   BLOCKED.

6. **Reproduce; do not reason.** Especially for anything platform-shaped. See
   below — this one is written in the author's own blood.

## Reproduce, do not reason

The `FileStorage` lazy-path test in this same change set failed CI **three
times**, each for a different host-dependent assertion the author reasoned their
way into:

- hard-coded that the sandboxed config lands under the temp dir (macOS puts it
  under `Library/Application Support`, Linux under XDG, Windows under APPDATA);
- compared path _spelling_ — macOS reports `/var/...` for a directory resolving
  to `/private/var/...`, Windows reports the 8.3 form (`RUNNER~1`);
- read a file with `.catch(() => null)` and asserted `not.toContain` on it,
  which throws on a null receiver — passing only on a machine that happens to
  have a real `config.json`.

Each was "obviously fine" by inspection. The fix each time was to simulate the
condition instead: an empty `HOME` with XDG and APPDATA unset reproduced the
third failure locally in one command.

Corollary: **a cross-platform assertion you have not run on that platform is a
guess.** Prefer assertions that hold everywhere — compare against the same
resolver production calls, or assert an inequality, rather than a path shape.

## Parallel agents

Two sweeps that start from the same grep produce the same blind spot twice.
Agreement between them is duplication, not corroboration. Deduplicate before
reporting, and never raise confidence because two agents said it.

## What a filed finding must carry

- The failing input or state, and the wrong output — concretely.
- `file:line` for the defect **and** for the code that makes it reachable.
- What you checked that would have falsified it.
- Whether a test already covers it, and if so why it does not catch this.
- Whether `.plans/` already owns it.

## Related

- [issue-tracker.md](./issue-tracker.md) — where findings become issues
- [triage-labels.md](./triage-labels.md) — labels for the result
- [../../AGENTS.md](../../AGENTS.md) — the four hazards and the "hit every seam" list
