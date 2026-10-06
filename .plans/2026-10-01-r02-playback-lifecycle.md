# R02 — Buffering and generation-safe player recovery

Status: READY FOR ASSIGNMENT; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Recover stalled playback without confusing buffering with a user pause or erasing a newer episode.
**Architecture:** Watchdog consumes explicit playback facts; PersistentMpvSession owns generation-scoped effects and commits. Services/app consume structured outcomes.
**Tech stack:** TypeScript, mpv IPC, injected clocks and controlled promises.
**Spec:** Audit A02/A03; [architecture](../.docs/architecture.md), [boundary map](../.docs/runtime-boundary-map.md).
**Dependencies:** Independent. R04/R08 depend on these outcomes.

## Review focus

1. User pause suspends recovery; buffering core-idle does not.
2. Every await in recovery is followed by a cycle-ownership check before shared mutation.
3. Stale failures/successes cannot clear a successor's cycle, flags, timers or IPC.
4. Stop/dispose/cancel settle pending work once and never trigger a late reconnect.
5. Resume/next/local media share the lifecycle and preserve timing/track preferences.

## R02.1 — Correct watchdog pause semantics (A02)

Allowed edits: `apps/cli/src/infra/player/playback-watchdog.ts` and `apps/cli/test/unit/infra/player/playback-watchdog.test.ts`; current property routing integration only if facts are missing.

- [ ] In the existing fake-clock harness, begin confirmed playback, freeze time position, set coreIdle=true, pause=false and low cache. Advance injected timers through the stall threshold. Expect one recovery request.
- [ ] Add the reverse case: pause=true with the same cache/core-idle facts; expect no recovery. Resume must re-arm, with no burst of overdue retries. Cover file-not-loaded, normal advancing playback and user cancellation.
- [ ] Read the actual mpv pause/core-idle/cache property descriptions. core-idle can occur while buffering, so it is not sufficient evidence of an explicit pause. [mpv property reference](https://mpv.io/manual/stable/#property-list).
- [ ] Define watchdog inputs around userPaused, confirmedProgress, cache/loading state and monotonic elapsed time. Reuse the existing data model when it already represents these facts; avoid adding a second pause state.
- [ ] Preserve the bounded attempts/cooldown and recovery result classification. No real sleep or hardcoded calendar dates in tests.

## R02.2 — Fence reconnect completions (A03)

Allowed edits: `apps/cli/src/infra/player/PersistentMpvSession.ts` and existing persistent session/harness/ready-work tests.

- [ ] Reproduce: episode E1 enters reconnect, its promise stays held; E2 starts and becomes active; reject E1's reconnect. Assert E2 still owns the cycle and remains usable. Repeat with E1 reconnect success, E2 cancelled, and dispose.
- [ ] Audit both catch and finally paths around reconnect, load, readiness, stop and disposal. Capture the cycle object/generation before the await; mutate shared state only if the current owner still matches.
- [ ] A helper may express the existing ownership rule:

```ts
const recoveryOwner = this.activeCycle;
await reconnect();
if (this.activeCycle !== recoveryOwner) return;
// Only this owner may commit recovery flags or clear its cycle.
```

Adapt to the real cycle/generation model. Ownership checks must also guard rejection cleanup; adding the check only on the success path leaves the original bug.

- [ ] Clear owner-scoped timers/listeners exactly once. Do not let an old callback close a newer IPC transport or reset ready/resolving flags.
- [ ] Retain interruption as a structured outcome. Do not report player success at spawn or load request; success requires confirmed progress.

## R02.3 — Unified lifecycle qualification

- [ ] Extend `apps/cli/test/integration/queue-playback-lifecycle.test.ts` for held old recovery followed by next/stop and `apps/cli/test/integration/persistent-mpv-local-transition-native.test.ts` for local→local transitions.
- [ ] Trace browse, palette, hotkey, autoplay and post-play entrypoints. R04 supplies local-source authority; do not put source selection into player infra.
- [ ] On a capable native runner, exercise controlled media with buffering, pause/resume, retry, next and SIGINT. Capture IPC/property evidence, final playback position and child-process cleanup. Record missing mpv/display/socket support as qualification limits.

## Verification and closure

```sh
bun run --cwd apps/cli test:file -- test/unit/infra/player/playback-watchdog.test.ts test/unit/infra/player/persistent-mpv-session.test.ts test/unit/infra/player/persistent-mpv-session-harness.test.ts test/unit/infra/player/persistent-ready-work-executor.test.ts
bun run --cwd apps/cli test:file -- test/integration/queue-playback-lifecycle.test.ts test/integration/persistent-mpv-local-transition-native.test.ts
bun run --cwd apps/cli typecheck
```

Update player/recovery portions of the architecture doc. Run runbook gates. Return held-promise regressions and native evidence separately; fixture mpv proves orchestration, not actual decoding or audible/video playback.
