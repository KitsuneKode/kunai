# PlaybackPhase.execute() Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Read the "Hard Constraints" section before touching code.**

**Goal:** Break `PlaybackPhase.execute()` (~2,860 lines, `apps/cli/src/app/PlaybackPhase.ts:564–3420`) into focused, testable units **without changing playback behavior**.

**Why:** It is the single largest method in the repo and the source of the "weird state / hard to reason about" risk. All state lives in local variables inside two nested `while(true)` loops, stitched by ~25 labeled `break`/`continue` jumps. That tangle is where playback bugs (like the from-history postplay lag) breed.

---

## Current structure (mapped 2026-06-13)

```
execute(title, context):                       line 564
  ├─ Setup & local helpers                      ~564–800
  │    (prefetch closures, navigate closures, runtime bindings, timing)
  ├─ OUTER: while (true)  // playback session loop   800–2670
  │    ├─ resolve + prepare stream
  │    ├─ play stream (mpv)
  │    └─ post-play transition + ~14 `continue` branches
  │         (episode nav, source/quality pick, recovery, playlist advance)
  └─ INNER: postPlayback: while (true)  // post-play menu   2674–3420
       └─ ~11 `break/continue postPlayback` branches
          (next/prev, source, quality, recommendations, recover, stop)
```

Plus ~12 sibling `private` methods already extracted (these are fine; the monster is `execute` itself).

## Hard Constraints (do not violate)

1. **Behavior must not change.** This is a pure refactor. No "while I'm here" fixes.
2. **Characterization tests FIRST.** Before extracting anything, add tests that pin the current observable behavior of the segment being extracted. If a segment cannot be characterized, do not extract it yet.
3. **Never change control-flow semantics.** The labeled `break/continue postPlayback` and the outer `continue` are load-bearing. Extractions must preserve exact ordering, early-exits, and which loop they target.
4. **Extract by returning directives, not by moving the loop.** A handler returns a value the loop acts on (e.g. `{ kind: "advance"; episode } | { kind: "stay" } | { kind: "exit"; outcome }`); the loop keeps owning the `continue`/`break`.
5. **One extraction per commit**, each green on `bun run --cwd apps/cli test:unit` + typecheck + lint before the next.

---

## Staged extraction order (lowest risk → highest)

### Stage 0: Characterization safety net

- [ ] Identify the existing playback/post-play tests (`apps/cli/test/unit/app/*`, `test/integration/*`). List behaviors already covered.
- [ ] Add characterization tests for the **post-play menu state machine** specifically: given a post-play action + session state, assert the resulting directive (advance / stay / recover / exit). This is the segment with the most branches and the highest extraction value.
- [ ] Commit: `test(playback): characterize post-play menu transitions`.

### Stage 1: Pure predicates (near-zero risk)

Extract the inline boolean derivations into pure, tested functions in a new `apps/cli/src/app/playback-postplay-policy.ts`:

- [ ] `nearEndVoluntaryQuit(...)` (currently ~2676–2687)
- [ ] `canResumePlayback(...)` (currently ~2725–2728)
- [ ] `autoContinueIntoRecommendationPossible(...)` (currently ~2786, already a named local — promote to a pure fn)
- [ ] Unit-test each with a truth table. Replace the inline expressions with calls.
- [ ] Commit: `refactor(playback): extract post-play predicates`.

### Stage 2: Post-play action handler (the big win)

- [ ] Define a directive type: `type PostPlayStep = { kind: "stay" } | { kind: "advance"; episode } | { kind: "recover" } | { kind: "exit"; outcome }`.
- [ ] Extract the body of each `case`/branch in the `postPlayback` loop into a `resolvePostPlayStep(action, ctx): PostPlayStep` (pure where possible; side-effecting calls passed as injected deps).
- [ ] The loop becomes: `const step = await resolvePostPlayStep(...); switch (step.kind) { … continue/break postPlayback … }` — control flow stays in the loop.
- [ ] Verify the Stage 0 characterization tests still pass unchanged.
- [ ] Commit: `refactor(playback): extract post-play step resolver`.

### Stage 3: Outer playback-loop navigation handlers

- [ ] Same directive pattern for the outer loop's ~14 `continue` branches (episode nav, source/quality pick, recovery).
- [ ] Commit per cohesive group.

### Stage 4: Setup extraction

- [ ] Move the setup closures (564–800) to module functions taking explicit params; the method shrinks to orchestration.
- [ ] Commit: `refactor(playback): extract execute() setup helpers`.

## Verification (after every stage)

```sh
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli lint
bun run --cwd apps/cli test:unit
```

Target end state: `execute()` reads as an orchestrator (~300–500 lines) delegating to named, tested units. Run a real playback session (`bun run dev`) after Stage 2 and Stage 4 to confirm behavior by hand.

## Stop conditions

- Stop if a segment cannot be characterized by a test before extraction — investigate, don't guess.
- Stop if an extraction forces a control-flow change — redesign the directive instead.
- Stop and report if test count/behavior changes in any way other than additions.
