# Videasy Runtime And Playback Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Videasy a fast, accurately named first-class provider with diagnosable live checks, while making autoplay and autoskip toggles truthful during active playback.

**Architecture:** Keep volatile provider mechanics inside `@kunai/providers`; preserve a distinct active catalog, fast resolve order, and legacy migration map. Route active autoskip changes through `PlayerControlService` into the live persistent mpv session, while session state remains the source for subsequent autoplay decisions. Diagnostics use structured redacted events and provider trace summaries rather than raw URLs or secrets.

**Tech Stack:** Bun, TypeScript, `@kunai/core` provider cycle, Ink CLI, persistent mpv IPC, Bun tests.

## Global Constraints

- Preserve the stable `videasy` provider id and existing legacy source-id migrations.
- User-facing provider copy must say `Videasy Direct`; external legacy names remain aliases only.
- Never store or print signed stream URLs, seeds, cookies, or tokens in diagnostics.
- Automatic provider work must have a bounded foreground budget; manual/background inventory may do broader work.
- A session autoskip toggle must apply to the active persistent mpv file and future files; autoplay applies at episode-boundary decisions.

---

### Task 1: Separate Active Videasy Catalog From Legacy Migration Records

**Files:**

- Modify: `packages/providers/src/videasy/flavors.ts`
- Modify: `packages/providers/src/videasy/direct.ts`
- Modify: `packages/providers/src/videasy/manifest.ts`
- Modify: `packages/providers/test/videasy-flavors.test.ts`
- Modify: `apps/cli/test/unit/app/source-quality.test.ts`
- Modify: `apps/cli/test/unit/services/playback/playback-source-inventory-projection.test.ts`

- [ ] Write failing tests proving active picker/catalog APIs exclude deprecated rows, fast order is `Neon`, `Cypher`, `Yoru`, and legacy source IDs normalize to active source IDs.
- [ ] Implement distinct active catalog, fast resolve tier, and legacy migration accessors; keep only the fast tier in foreground resolve and retain remaining active sources for background/manual inventory.
- [ ] Change manifest display copy to `Videasy Direct` and a concise capability-focused description; set `recommended: true` after live/runtime gates pass.
- [ ] Run provider and affected CLI unit tests.

### Task 2: Make Seed Transport Host-Affine And Bounded

**Files:**

- Modify: `packages/providers/src/videasy/direct.ts`
- Modify: `packages/providers/test/providers.test.ts`
- Modify: `packages/providers/test/videasy-preferred-fallback.test.ts`

- [ ] Write failing tests for primary seed/source pairing, fallback seed/source pairing, and cache keys scoped by host plus media ID.
- [ ] Replace the string seed result with a transport selection `{ apiBase, seed }`; use that selected base for the corresponding source request and cache by `{ apiBase, mediaId }`.
- [ ] Bound the primary seed/source attempt and let the provider cycle continue on transient failures without endpoint-wide permanent quarantine.
- [ ] Run focused provider tests.

### Task 3: Make Live Matrix Output Diagnostic, Not Merely Boolean

**Files:**

- Modify: `apps/cli/test/live/videasy-bloodhounds.smoke.ts`
- Modify: `apps/cli/test/live/videasy-live-assertions.ts`
- Modify: `apps/cli/test/unit/live/videasy-live-assertions.test.ts`
- Modify: `apps/cli/test/live/README.md`
- Modify: `.docs/provider-dossiers/videasy.md`

- [ ] Write failing pure tests for stage classification and redacted stage summaries.
- [ ] Include resolve-stage outcome/timing summaries (`seed`, `source`, `decrypt`, `stream-probe`) without URLs or secrets, and distinguish upstream/transient evidence from a harness failure.
- [ ] Correct fixture `year` typing and retain functional/performance/order scoring.
- [ ] Run the focused live assertion unit test, cold live check once, then the four-title suite once.

### Task 4: Apply Autoskip Changes To Active mpv Playback

**Files:**

- Modify: `apps/cli/src/infra/player/PlayerControlService.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`
- Modify: `apps/cli/src/infra/player/PersistentMpvSession.ts`
- Modify: `apps/cli/src/app-shell/active-playback-command-dispatcher.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/diagnostics/operation-taxonomy.ts`
- Test: `apps/cli/test/unit/app-shell/active-playback-command-dispatcher.test.ts`
- Test: `apps/cli/test/unit/infra/player/persistent-mpv-session-harness.test.ts`

- [ ] Write failing tests proving an active autoskip toggle calls the player-control update, disabling it cancels any scheduled automatic skip, and a later toggle re-evaluates the current segment.
- [ ] Add `updateCurrentPlaybackSkipPolicy` to the player-control contract and `updateSkipPolicy` to the active player control; make `PersistentMpvSession` replace its current options, clear stale timers/prompts, and immediately re-evaluate current position.
- [ ] Dispatch the updated policy from the active command route after state transition, and record a structured `playback.autoskip.changed` diagnostic with session and active-player application facts.
- [ ] Run focused player/control tests.

### Task 5: Verify The Integrated Contract

**Files:**

- Modify only docs/tests needed for truth corrections discovered by validation.

- [ ] Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run --cwd apps/cli test`, `bun run --cwd packages/providers test`, and `bun run build`.
- [ ] Run `bun run test:live:videasy:suite`; report a classified upstream issue rather than claiming a failure is a code regression when evidence says otherwise.
- [ ] Review `git diff --check` and leave unrelated worktree changes untouched.
