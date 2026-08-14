# Plan 009: Cut the pre-playback health round-trip on freshly-resolved streams

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/services/playback/PlaybackResolveService.ts`
> Mismatch vs excerpts → STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: 007 (share the dead-stream fallback path understanding; not a hard code dependency)
- **Category**: perf
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Every playback start pays an extra network round-trip: after a provider returns a fresh stream, `PlaybackResolveService` runs a forced health check (HEAD/range, or an HLS-manifest GET) _before_ handing the URL to mpv. For a stream the provider just resolved, this adds directly to perceived "time to video" — the exact metric the user flags. The dead-stream fallback loop already exists to catch a URL mpv can't play, so the pre-flight gate on _fresh_ streams is largely redundant with mpv's own early-failure handling. Reserving the forced gate for cache hits (where staleness is the real risk) and trusting fresh resolves — or running the check with a tight timeout in parallel with mpv spawn — removes the stall without risking dead-URL playback.

## Current state

`apps/cli/src/services/playback/PlaybackResolveService.ts`:

- Cache-hit gate at `:253` and inventory gate at `:352` — these are legitimate (cached streams can be stale).
- Fresh-resolve gate at `:538-555`:

```ts
if (
  candidateStream.deferredLocator ||
  (!this.deps.streamHealth && !this.deps.streamHealthService)
) {
  resolvedStream = candidateStream;
  break; // already skipped for deferred locators / no health checker
}
const health = await this.checkCachedStreamHealth(candidateStream, {
  force: true,
  signal: input.signal,
  phase: "resolve-gate", // <-- forced check on a freshly resolved stream
});
// …emits cache-health-check event…
if (health.healthy) {
  resolvedStream = candidateStream;
  break;
}
// else marks the attempt failed and continues fallback
```

- Dead-stream fallback after mpv reports failure lives at ~`:557-635` (the `blockedStreamUrls` + second `resolveWithFallback` path).

Repo conventions: health checking is behind `this.deps.streamHealth` / `streamHealthService` ports; phases are tagged (`resolve-gate`, etc.); conventional commits.

## Commands you will need

| Purpose   | Command                                                                                         | Expected                                                      |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Typecheck | `bun run typecheck`                                                                             | exit 0                                                        |
| Lint      | `bun run lint`                                                                                  | exit 0                                                        |
| One file  | `cd apps/cli && bun run test:file test/unit/services/playback/playback-resolve-service.test.ts` | pass                                                          |
| CLI tests | `bun run --cwd apps/cli test`                                                                   | pass                                                          |
| Manual    | `bun run dev`                                                                                   | stream starts noticeably faster; dead streams still fall back |

## Scope

**In scope**:

- `apps/cli/src/services/playback/PlaybackResolveService.ts` (only the fresh-resolve gate at `:538`; leave the cache-hit `:253` and inventory `:352` gates untouched)
- `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts` (extend)

**Out of scope**:

- Cache-hit / inventory health gates (staleness protection — keep them).
- `checkCachedStreamHealth` internals / the health-check ports.
- The dead-stream fallback loop mechanics (only rely on it, don't change it).

## Git workflow

- Branch: `advisor/009-resolve-gate-latency`
- Commit: `perf(playback): skip forced health gate on freshly resolved streams`

## Steps

### Step 1: Choose the strategy

Two safe options — pick based on how the dead-stream fallback is triggered:

- **Option A (trust fresh, rely on fallback)**: for `phase: "resolve-gate"` on a _freshly resolved_ (non-cache-hit) stream, skip the forced pre-flight and hand the stream to mpv; let mpv's early end-file error drive the existing dead-stream fallback (`blockedStreamUrls` + re-resolve). Verify the fallback path actually re-enters resolution when mpv fails immediately (`grep -n "blockedStreamUrls\|dead" apps/cli/src/app/playback/PlaybackPhase.ts` and confirm a fast mpv failure loops back).
- **Option B (parallel gate)**: keep the check but run it with a tight timeout (e.g. 1500ms) _in parallel_ with mpv spawn instead of blocking before spawn; if it comes back unhealthy, abort and fall back.

Default to **Option A** if you can confirm the dead-stream fallback covers an immediate mpv failure; otherwise Option B.

If neither can be confirmed safe from the code, STOP and report.

**Verify**: document the chosen option in the commit body.

### Step 2: Implement

For Option A: gate the forced check behind "is this a cache hit?" — pass through fresh resolves. Ensure `deferredLocator` and no-health-checker short-circuits remain. For Option B: restructure so the health promise races the spawn with a timeout.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Tests

- A freshly resolved healthy stream is returned without a forced pre-flight health call (Option A: assert `checkCachedStreamHealth` not called with `phase: "resolve-gate"`; Option B: assert it doesn't block the returned stream).
- A cache-hit stream STILL gets its health gate (assert the `:253` path unchanged).
- A stream mpv can't play still triggers fallback (existing behavior preserved — extend the existing dead-stream test).

**Verify**: `cd apps/cli && bun run test:file test/unit/services/playback/playback-resolve-service.test.ts` → pass.

### Step 4: Full gates + manual smoke

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0. Manual: `bun run dev`, start a title — video should begin faster; then force a dead stream (e.g. a known-bad provider) and confirm it still falls back to a working source.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0; resolve-service tests pass
- [ ] Fresh resolves no longer block on a forced `resolve-gate` health round-trip (test proves it)
- [ ] Cache-hit and inventory gates unchanged (test proves the `:253`/`:352` paths still gate)
- [ ] Dead-stream fallback still works (test + manual)
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- You cannot confirm the dead-stream fallback re-enters resolution on an immediate mpv failure → do NOT pick Option A; use Option B or report.
- Removing the gate makes an existing test fail in a way that shows fresh streams genuinely need pre-flight validation (some providers hand back URLs that 403 instantly) — report; Option B is the fallback.
- The distinction "cache hit vs fresh resolve" is not available at `:538` — report what state is in scope there.

## Maintenance notes

- This trades a guaranteed pre-flight for reliance on mpv's failure signal + fallback. Reviewer must confirm the fallback is robust and fast, or the user sees a dead-stream error instead of a silent switch.
- Interacts with plan 007 (resolve deadline): the fallback re-resolve must also respect the total deadline.
- If provider quality degrades and instant-403 streams become common, revisit Option B (parallel gate) as the safer default.
