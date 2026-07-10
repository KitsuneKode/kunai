# AD11 Reliability Sweep Follow-Up Implementation Plan

## Implementation Summary

**Status: Implemented (2026-07-10)** on `cursor/ad11-reliability-integration-a0e0`.

Landed the six unique `ad11` PR merges (duplicate CI branch left unmerged), then closed follow-up Tasks 0–14:

- P0: YouTube diagnostics probe restore; live `cancellationReason` ref; degraded-all-down fallback diagnostics
- Overlay/cache/honesty: browse calendar pause under overlays, browse preserve tests, `qualityPreference` cache-key note, stream honesty + stale inventory age
- Planned gaps: playing footer vs help/`?` mpv overflow parity, bounded provider attempt timeline in `/diagnostics`, latest-10 export/trace retention, ErrorShell recovery hardening (`SoftFailBoundary`)
- Docs/truth/changeset: this plan + truth index + release notes

**Still deferred (Non-Goals):** subtitle/source preference learning, HLS user-config benchmarks, full player actor, greenfield `AppErrorBoundary`, live provider CI.

**Task 15** (full fmt/lint/typecheck/test gate + manual smoke) remains the integration PR verification checklist; code Tasks 0–14 are complete.

---

## Non-Goals

- Do not implement subtitle/source preference learning.
- Do not run or automate HLS startup benchmarks against user mpv configs.
- Do not promote the playback command queue into a full player actor.
- Do not redesign provider scraping or add providers.
- Do not add live provider calls to default CI/`bun run test`.
- Do not build a greenfield `AppErrorBoundary` React tree rewrite; reuse `ErrorShell` / `playbackProblem` seams if hardening error UX.

## Prerequisites / Branch Strategy

```text
Integration branch (recommended):
  cursor/ad11-reliability-integration-a0e0

Merge order onto that branch:
  1. origin/cursor/remaining-reliability-hardening-ad11
  2. origin/cursor/shell-overlay-state-preservation-ad11
  3. origin/cursor/shell-keybind-first-press-ad11   ← shell-frame.tsx conflict
  4. origin/cursor/diagnostics-trust-and-usability-ad11
  5. origin/cursor/playback-reliability-cache-and-fallback-ad11
  6. origin/cursor/provider-ui-honesty-ad11         ← SourceInventoryService conflict

Close as duplicate (do not merge):
  origin/cursor/ci-shared-test-stabilization-ad11
  (byte-identical to remaining-reliability-hardening-ad11)
```

After each merge step: `bun run test` for touched packages; after the full stack: `bun run fmt && bun run lint && bun run typecheck && bun run test`.

If the `ad11` PRs are already merged to `main` when this plan runs, skip Phase 0 merge steps and start at Task 2 (verify shell-frame combined behavior), then continue.

## File Map

| Area                          | Primary files                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell input merge             | `apps/cli/src/app-shell/shell-frame.tsx`, `apps/cli/src/app-shell/RootContentInputGate.tsx`, `apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx`, `apps/cli/test/unit/app-shell/post-play-keybind-once.useinput.test.tsx`                                                              |
| Overlay preserve + effects    | `apps/cli/src/app-shell/root-content-shell.tsx`, `apps/cli/src/app-shell/browse-shell.tsx`, `apps/cli/src/app-shell/shell-screen-clear.ts` (or equivalent), tests under `apps/cli/test/unit/app-shell/`                                                                                             |
| Diagnostics YouTube probe     | `apps/cli/src/app-shell/workflows/shell-workflows.ts`, `apps/cli/src/app-shell/root-overlay-shell.tsx`, `apps/cli/src/app-shell/diagnostics-panel-source.ts`, `apps/cli/src/domain/session/SessionState.ts`, `apps/cli/src/services/youtube/youtube-diagnostics-probes.ts`                          |
| Playback preserve/fallback    | `apps/cli/src/services/playback/PlaybackResolveService.ts`, `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`, `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`, `apps/cli/src/app/playback/playback-provider-fallback.ts`, `apps/cli/src/app/playback/PlaybackPhase.ts` |
| Inventory honesty + cache key | `apps/cli/src/services/playback/SourceInventoryService.ts`, `apps/cli/src/app-shell/tracks-panel-data.ts`, `packages/providers/src/shared/direct-stream-source.ts` (or branch path), `packages/storage/src/repositories/source-inventory.ts`                                                        |
| Footer/GO parity              | `apps/cli/src/app-shell/keybindings.ts`, `apps/cli/src/app-shell/loading-shell-model.ts`, `apps/cli/src/app-shell/shell-primitives.tsx`, `.docs/keybindings.md`, `.docs/ux-architecture.md`                                                                                                         |
| Docs / truth                  | `.plans/kunai-playback-reliability-implementation.md`, `.plans/plan-implementation-truth.md`, `.docs/diagnostics-guide.md`                                                                                                                                                                          |

---

## Phase 0 — Integrate the AD11 Stack

### Task 0: Close duplicate CI PR and open integration branch

**Files:** none (git only)

- [x] **Step 1: Create integration branch from current `main`**

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b cursor/ad11-reliability-integration-a0e0
```

- [x] **Step 2: Merge foundation PR**

```bash
git merge --no-ff origin/cursor/remaining-reliability-hardening-ad11 \
  -m "merge: ad11 CI/test stabilization + Videasy preferred fallback"
```

Expected: clean or trivial conflicts only in docs/changesets.

- [x] **Step 3: Mark duplicate branch closed in PR description / comment**

Do not merge `origin/cursor/ci-shared-test-stabilization-ad11`. In the GitHub PR UI (or `ManagePullRequest` comment), note it is identical to the foundation branch and should be closed.

- [x] **Step 4: Commit nothing else; push integration branch**

```bash
git push -u origin cursor/ad11-reliability-integration-a0e0
```

---

### Task 1: Merge shell overlay, then keybind, resolving `shell-frame.tsx`

**Files:**

- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Test: `apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx`
- Test: `apps/cli/test/unit/app-shell/post-play-keybind-once.useinput.test.tsx` (from keybind branch)

- [x] **Step 1: Merge overlay branch**

```bash
git merge --no-ff origin/cursor/shell-overlay-state-preservation-ad11 \
  -m "merge: ad11 shell overlay state preservation"
```

- [x] **Step 2: Merge keybind branch and expect `shell-frame.tsx` conflict**

```bash
git merge --no-ff origin/cursor/shell-keybind-first-press-ad11 \
  -m "merge: ad11 shell keybind first-press fix"
```

- [x] **Step 3: Resolve `shell-frame.tsx` to include BOTH behaviors**

Final `useInput` / lock logic must match this shape (adapt imports to whatever the overlay branch named the gate file — prefer `RootContentInputGate.tsx`):

```tsx
const inputSuspended = useRootContentInputSuspended();
const effectivelyLocked = inputLocked || inputSuspended;

useInput((input, key) => {
  if (inputSuspended) return;
  if (isHardGlobalQuit(input, key)) {
    requestHardExit(0);
  }
});

const { commandMode, commandInput, commandCursor, highlightedIndex } = useShellInput({
  footerActions,
  commands,
  disabled: effectivelyLocked,
  letterKeysHandledExternally,
  escapeAction,
  onResolve,
});

useInput((input, key) => {
  if (effectivelyLocked || commandMode) return;
  if (input === "?") {
    onResolve("help");
    return;
  }
  // Footer-owned letters are already resolved by useShellInput. Forwarding
  // them again to onUnhandledInput double-dispatches post-play/playback
  // actions. Surfaces that own letters themselves opt in via
  // letterKeysHandledExternally and still receive the key here.
  if (!letterKeysHandledExternally) {
    const matchKey = input.toLowerCase();
    if (footerActions.some((action) => action.key === matchKey && !action.disabled)) {
      return;
    }
  }
  onUnhandledInput?.(input, key);
});
```

- [x] **Step 4: Run shell input tests**

```bash
bun run test -- apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx \
  apps/cli/test/unit/app-shell/post-play-keybind-once.useinput.test.tsx \
  apps/cli/test/unit/app-shell/root-content-state.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit conflict resolution if merge left uncommitted resolution**

```bash
git add apps/cli/src/app-shell/shell-frame.tsx
git commit -m "fix(shell): combine overlay input suspend with footer keybind gate"
```

---

### Task 2: Merge diagnostics, playback, and provider-ui branches

**Files:**

- Conflict likely: `apps/cli/src/services/playback/SourceInventoryService.ts`
- Conflict likely: related unit tests under `apps/cli/test/unit/services/playback/`

- [x] **Step 1: Merge diagnostics**

```bash
git merge --no-ff origin/cursor/diagnostics-trust-and-usability-ad11 \
  -m "merge: ad11 diagnostics trust and usability"
```

- [x] **Step 2: Merge playback cache/fallback**

```bash
git merge --no-ff origin/cursor/playback-reliability-cache-and-fallback-ad11 \
  -m "merge: ad11 playback cache identity and fallback hardening"
```

- [x] **Step 3: Merge provider-ui honesty; resolve `SourceInventoryService`**

```bash
git merge --no-ff origin/cursor/provider-ui-honesty-ad11 \
  -m "merge: ad11 provider UI honesty"
```

Keep **both**:

- `qualityPreference` in `SourceInventoryCacheInput` + `buildSourceInventoryCachePreimage`
- `getEntry()` returning `{ inventory, createdAt, expiresAt }` (or equivalent) for tracks-panel age hints

Example combined cache input shape:

```ts
export type SourceInventoryCacheInput = {
  readonly providerId: string;
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly audioMode?: string;
  readonly subtitleLanguage?: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly runtime?: ProviderRuntime;
  readonly schemaVersion?: string;
};
```

- [x] **Step 4: Full verification after stack merge**

```bash
bun run fmt
bun run lint
bun run typecheck
bun run test
```

Expected: all pass.

- [x] **Step 5: Push integration branch**

```bash
git push -u origin cursor/ad11-reliability-integration-a0e0
```

---

## Phase 1 — P0 Regressions From The Sweep

### Task 3: Restore YouTube diagnostics probes on the unified overlay path

**Files:**

- Modify: `apps/cli/src/domain/session/SessionState.ts` (`OverlayState` diagnostics variant)
- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts` (`handleDiagnostics`)
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/diagnostics-panel-source.ts` (if needed)
- Modify: `apps/cli/src/app-shell/root-overlay-bridge.ts` / `root-shell-state.ts` type extracts if they list diagnostics fields
- Test: `apps/cli/test/unit/app-shell/diagnostics-youtube-probe.test.ts` (create)
- Test: keep `apps/cli/src/services/diagnostics/diagnostics-trust.test.ts` green

**Problem:** After diagnostics unification, workflow `/diagnostics` opens `{ type: "diagnostics" }` and `root-overlay-shell.tsx` builds lines via `buildDiagnosticsPanelInput(container)` with no live YouTube probe. Main’s old workflow path ran `runYoutubeDiagnosticsProbes()` first.

- [x] **Step 1: Write failing test for probe threading**

Create `apps/cli/test/unit/app-shell/diagnostics-youtube-probe.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildDiagnosticsPanelLines } from "@/app-shell/panel-data";
import type { YoutubeDiagnosticsProbe } from "@/services/youtube/youtube-diagnostics-probes";

const probe: YoutubeDiagnosticsProbe = {
  ytDlp: { available: true, version: "2026.01.01" },
  invidious: {
    ok: true,
    instance: "https://example.test",
    latencyMs: 12,
  },
};

describe("diagnostics youtube probe parity", () => {
  test("panel lines include yt-dlp probe when youtubeProbe is provided", () => {
    const lines = buildDiagnosticsPanelLines({
      // minimal required panel input fields — expand to match DiagnosticsPanelLineInput
      recentEvents: [],
      youtubeProbe: probe,
    } as Parameters<typeof buildDiagnosticsPanelLines>[0]);
    const joined = lines.join("\n");
    expect(joined).toMatch(/yt-dlp/i);
  });
});
```

Adjust the cast to a real `buildDiagnosticsPanelInput`-shaped fixture once you inspect `panel-data.ts` / `diagnostics-panel-source.ts` on the integration branch. Prefer constructing via `buildDiagnosticsPanelInput` with a fake container if that is easier.

- [x] **Step 2: Run test to verify current gap (or that fixture needs wiring)**

```bash
bun run test -- apps/cli/test/unit/app-shell/diagnostics-youtube-probe.test.ts
```

- [x] **Step 3: Extend diagnostics overlay payload**

In `SessionState.ts`:

```ts
| {
    type: "diagnostics";
    youtubeProbe?: import("../../services/youtube/youtube-diagnostics-probes").YoutubeDiagnosticsProbe;
  }
```

Prefer a top-level import of `YoutubeDiagnosticsProbe` if the file already uses value imports; keep the type-only import style consistent with the file.

- [x] **Step 4: Restore probe in `handleDiagnostics`**

```ts
async function handleDiagnostics(container: Container): Promise<"handled"> {
  recordDiagnosticsPanelMemorySample(container, "diagnostics-command");
  const { runYoutubeDiagnosticsProbes } =
    await import("@/services/youtube/youtube-diagnostics-probes");
  const youtubeProbe = await runYoutubeDiagnosticsProbes(container);
  await openRootOwnedOverlay(container, { type: "diagnostics", youtubeProbe });
  return "handled";
}
```

- [x] **Step 5: Pass probe into panel builder in `root-overlay-shell.tsx`**

```tsx
overlay.type === "diagnostics"
  ? buildDiagnosticsPanelLines(
      buildDiagnosticsPanelInput(container, {
        youtubeProbe: overlay.youtubeProbe,
      }),
    )
  : [];
```

Also update the palette `/diagnostics` path if it opens the same overlay type without a probe — either run probes there too, or document that only the workflow command refreshes live probes and the panel falls back to `extractYoutubeProbeFromEvents`. Preferred: run probes for both entry points so UX matches.

- [x] **Step 6: Re-run tests**

```bash
bun run test -- apps/cli/test/unit/app-shell/diagnostics-youtube-probe.test.ts \
  apps/cli/src/services/diagnostics/diagnostics-trust.test.ts
bun run typecheck
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/cli/src/domain/session/SessionState.ts \
  apps/cli/src/app-shell/workflows/shell-workflows.ts \
  apps/cli/src/app-shell/root-overlay-shell.tsx \
  apps/cli/test/unit/app-shell/diagnostics-youtube-probe.test.ts
git commit -m "fix(diagnostics): restore YouTube probes on unified overlay path"
```

---

### Task 4: Make `cancellationReason` an explicit live field (drop `defineProperty`)

**Files:**

- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts` (input type)
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts` (call sites that mutate abort reason)
- Test: existing resolve/work-service tests; add one focused unit test if none covers late reason updates

**Problem:** Playback PR re-binds `cancellationReason` with `Object.defineProperty` because object spread snapshots getters. That is correct but opaque.

- [x] **Step 1: Introduce a small live-reason holder type**

In `PlaybackResolveService.ts` (or a tiny adjacent module if the service file is already huge):

```ts
export type ResolveCancellationReasonRef = {
  current?: ResolveCancellationReason;
};

// On PlaybackResolveInput:
readonly cancellationReasonRef?: ResolveCancellationReasonRef;
/** Snapshot at call time; prefer cancellationReasonRef for late updates. */
readonly cancellationReason?: ResolveCancellationReason;
```

Helper:

```ts
export function readCancellationReason(
  input: Pick<PlaybackResolveInput, "cancellationReason" | "cancellationReasonRef">,
): ResolveCancellationReason | undefined {
  return input.cancellationReasonRef?.current ?? input.cancellationReason;
}
```

- [x] **Step 2: Replace defineProperty sites**

In coordinator / work service, stop redefining properties. Pass through:

```ts
const resolveInput: PlaybackResolveInput = {
  ...input,
  cancellationReasonRef: input.cancellationReasonRef ?? {
    current: input.cancellationReason,
  },
  onEvent: (event) => {
    /* existing */
  },
};
```

In `PlaybackPhase`, when abort intents fire, set `cancellationReasonRef.current = "user-navigation"` (etc.) instead of mutating a getter-backed field.

- [x] **Step 3: Update all `input.cancellationReason` reads in resolve commit/policy paths to use `readCancellationReason(input)`**

Search:

```bash
rg -n "cancellationReason" apps/cli/src/services/playback apps/cli/src/app/playback
```

- [x] **Step 4: Run playback resolve tests**

```bash
bun run test -- apps/cli/test/unit/services/playback \
  apps/cli/test/unit/app/playback-recovery-policy.test.ts \
  apps/cli/test/unit/app/playback-provider-fallback.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/cli/src/services/playback apps/cli/src/app/playback
git commit -m "refactor(playback): replace cancellationReason defineProperty with live ref"
```

---

### Task 5: Emit degraded-fallback diagnostics when all alternates are down

**Files:**

- Modify: `apps/cli/src/app/playback/playback-provider-fallback.ts`
- Modify: call sites in `PlaybackPhase.ts` and `run-post-playback-menu.ts`
- Test: `apps/cli/test/unit/app/playback-provider-fallback.test.ts`

- [x] **Step 1: Extend pick result metadata (keep return type backward compatible)**

Prefer adding an optional out-parameter or richer return without breaking callers:

```ts
export type FallbackPickResult = {
  readonly provider: FallbackProviderCandidate;
  readonly degradedAllDown: boolean;
};

export function pickCompatibleFallbackProviderDetailed(
  providers: readonly FallbackProviderCandidate[],
  currentProviderId: string,
  options: PickCompatibleFallbackProviderOptions = {},
): FallbackPickResult | undefined {
  // same eligibility logic as branch; set degradedAllDown when eligible.length === 0 && alternates.length > 0
}
```

Keep `pickCompatibleFallbackProvider` as a thin wrapper returning `.provider` for existing call sites, or update call sites in the same commit.

- [x] **Step 2: Record diagnostics when `degradedAllDown`**

At call sites that already have `container.diagnosticsService`:

```ts
if (pick?.degradedAllDown) {
  container.diagnosticsService.record({
    category: "playback",
    operation: "playback.fallback.degraded",
    message: "All alternate providers unhealthy; trying first alternate anyway",
    context: {
      fromProviderId: currentProviderId,
      toProviderId: pick.provider.metadata.id,
    },
  });
}
```

- [x] **Step 3: Add unit test asserting `degradedAllDown: true` when every alternate is down**

- [x] **Step 4: Run tests and commit**

```bash
bun run test -- apps/cli/test/unit/app/playback-provider-fallback.test.ts
git add apps/cli/src/app/playback/playback-provider-fallback.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/src/app/playback/run-post-playback-menu.ts \
  apps/cli/test/unit/app/playback-provider-fallback.test.ts
git commit -m "fix(playback): diagnose degraded fallback when all providers are down"
```

---

## Phase 2 — Overlay / Cache / Honesty Hardening

### Task 6: Pause browse calendar timer while input is suspended

**Files:**

- Modify: `apps/cli/src/app-shell/browse-shell.tsx` (~line 303 `setInterval`)
- Test: `apps/cli/test/unit/app-shell/browse-calendar-suspend.test.ts` (create) or extend existing browse/calendar hook tests

- [x] **Step 1: Gate the interval on `useRootContentInputSuspended()`**

```tsx
const inputSuspended = useRootContentInputSuspended();

useEffect(() => {
  if (inputSuspended) return;
  const id = setInterval(() => setCalendarNow(Date.now()), 60_000);
  return () => clearInterval(id);
}, [inputSuspended]);
```

- [x] **Step 2: Add a small hook-level or component-level test** proving the interval is not scheduled when suspended (fake timers).

- [x] **Step 3: Commit**

```bash
git commit -m "fix(shell): pause browse calendar ticks under root overlays"
```

---

### Task 7: Integration test — browse state survives overlay open/close

**Files:**

- Create: `apps/cli/test/unit/app-shell/overlay-preserves-browse-state.test.tsx`
- May need: existing root-content helpers from `root-content-state.test.tsx`

- [x] **Step 1: Write failing render test**

Sketch (adapt to actual root content APIs on the integration branch):

```tsx
test("browse query survives settings overlay open and close", async () => {
  // 1. Mount root content in browse with query "Dune"
  // 2. Dispatch openRootOwnedOverlay({ type: "settings" }) / equivalent transition
  // 3. Assert browse tree still mounted (overlay-over-mounted)
  // 4. Close overlay
  // 5. Assert query still "Dune" and selection unchanged
});
```

- [x] **Step 2: Implement only if the overlay merge did not already cover this; otherwise strengthen assertions.**

- [x] **Step 3: Strengthen `shell-screen-clear` test**

Replace “function exists” assertions with:

```ts
test("clearRootContentTransitionFrame does not emit full ANSI clear", () => {
  const writes: string[] = [];
  clearRootContentTransitionFrame({ write: (s) => writes.push(s) });
  expect(writes.join("")).not.toContain("\x1b[2J");
});
```

Adapt to the real function signature on the branch.

- [x] **Step 4: Commit**

```bash
git commit -m "test(shell): prove browse state and screen clear under overlays"
```

---

### Task 8: Document / bump inventory cache identity for `qualityPreference`

**Files:**

- Modify: `apps/cli/src/services/playback/SourceInventoryService.ts` (schemaVersion default or preimage comment)
- Modify: `.docs/diagnostics-guide.md` or `.docs/architecture.md` short note
- Optional: bump `schemaVersion` constant used in inventory cache keys if one already exists

- [x] **Step 1: If `schemaVersion` is part of the preimage, bump it** (e.g. `"source-inventory-v2"` → `"source-inventory-v3-quality"`) so old rows miss cleanly by design rather than colliding on partial keys.

- [x] **Step 2: Add a one-line comment above `qualityPreference` in the preimage builder:**

```ts
// qualityPreference partitions inventory so 1080p vs 720p prefs do not share a row.
// Bumping schemaVersion intentionally invalidates pre-qualityPreference cache entries.
```

- [x] **Step 3: Add a unit test that two inputs differing only by `qualityPreference` produce different cache keys** (playback branch may already have this — verify and keep).

- [x] **Step 4: Commit**

```bash
git commit -m "fix(cache): document qualityPreference inventory key partition"
```

---

### Task 9: Provider-ui honesty follow-ups (deferred-locator + stale threshold)

**Files:**

- Modify: `apps/cli/src/app-shell/tracks-panel-data.ts`
- Modify: stream/quality picker helpers that use `isPlayableStreamCandidate`
- Modify: `packages/providers/src/shared/direct-stream-source.ts` (or branch path)
- Test: `apps/cli/test/unit/app-shell/tracks-panel-data.test.ts`, `direct-stream-source.test.ts`

- [x] **Step 1: Confirm resolve path still auto-selects materializable deferred streams**

Add a regression test: inventory with only deferred locators still resolves a stream via materialization/auto-select, even though the quality picker filters them out.

- [x] **Step 2: Soften hardsub mislabel risk**

In `inferSubtitleDelivery`, if stream metadata already has `subtitleDelivery` or hardsub evidence, preserve it; only default to `"external"` when unknown.

- [x] **Step 3: Tie stale threshold to inventory TTL when available**

```ts
export function crossProviderInventoryStaleAfterMs(expiresAt?: string, nowMs = Date.now()): number {
  if (!expiresAt) return CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS;
  const ttl = Math.max(0, exp - nowMs);
  // Mark stale at half TTL, floored to at least 2 minutes.
  return Math.max(CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS, Math.floor(ttl / 2));
}
```

- [x] **Step 4: Run honesty tests and commit**

```bash
bun run test -- apps/cli/test/unit/app-shell/tracks-panel-data.test.ts \
  apps/cli/test/unit/providers/direct-stream-source.test.ts
git commit -m "fix(ui): harden stream honesty heuristics and stale inventory age"
```

---

## Phase 3 — Planned Gaps The Sweep Did Not Cover

### Task 10: Footer vs GO / mpv hint parity (P2)

**Files:**

- Modify: `apps/cli/src/app-shell/loading-shell-model.ts` (`buildLoadingFooterActions`)
- Modify: `apps/cli/src/app-shell/keybindings.ts` (`footerPriority` / `helpOnly` for player chords)
- Modify: `.docs/keybindings.md`
- Modify: `.plans/kunai-playback-reliability-implementation.md` (mark P2 done or document overflow)
- Test: `apps/cli/test/unit/app-shell/loading-shell-model.test.ts` (create or extend)
- Test: `apps/cli/test/unit/app-shell/keybindings.test.ts`

**Product decision (locked for this plan):** Keep the persistent footer dense and honest. Do **not** dump every mpv-bridge chord into the footer. Instead:

1. Footer during `operation === "playing"` already includes next/prev/source/stop via `buildLoadingFooterActions` — keep that as the terminal-owned set.
2. Ensure `helpOnly` player bindings document mpv-owned chords (`k` quality, `Ctrl+R` refresh, `u` autoskip, etc.) so `?` / help overlay matches the bridge.
3. Add a single muted secondary hint line (or help-only group label) that says overflow actions live in `/` and `?`, matching `.docs/ux-architecture.md` footer density rules.

- [x] **Step 1: Audit mismatch**

```bash
rg -n "footerPriority|helpOnly|player-quality|player-autoskip|Ctrl\\+R" apps/cli/src/app-shell/keybindings.ts
rg -n "playingFooterActions|buildLoadingFooterActions" apps/cli/src/app-shell/loading-shell-model.ts
```

Build a table in the PR description: terminal footer keys vs mpv bridge keys vs help overlay.

- [x] **Step 2: Write failing keybinding/footer tests**

```ts
test("playing footer includes next/prev/source when series playback", () => {
  const actions = buildLoadingFooterActions({
    operation: "playing",
    hasNextEpisode: true,
    hasPreviousEpisode: true,
    isSeriesPlayback: true,
    footerMode: "detailed",
  } as LoadingShellState);
  const keys = actions.map((a) => a.key);
  expect(keys).toContain("n");
  expect(keys).toContain("p");
  expect(keys).toContain("o");
});

test("player help documents mpv-owned quality and refresh chords", () => {
  const sections = helpSectionsForScope("player");
  const labels = sections.flatMap((s) => s.items.map((i) => i.label)).join(" ");
  expect(labels.toLowerCase()).toMatch(/quality/);
});
```

- [x] **Step 3: Adjust `footerPriority` / `helpOnly` so help overlay is complete; keep footer capped via `selectFooterActions`**

- [x] **Step 4: Update `.docs/keybindings.md` and mark P2 resolved in the playback reliability plan**

- [x] **Step 5: Commit**

```bash
git commit -m "fix(shell): align playing footer with help overlay for mpv overflow chords"
```

---

### Task 11: Diagnostics panel — provider attempt timeline section

**Files:**

- Modify: `apps/cli/src/app-shell/panel-data.ts` (or diagnostics line builders)
- Modify: `apps/cli/src/services/diagnostics/diagnostics-insight.ts` if summary helpers help
- Docs: `.docs/diagnostics-guide.md`
- Test: unit test for timeline line rendering with a fake `ProviderAttemptTimeline`

**Scope cap:** Render a **bounded** section (last N attempts, redacted) under the existing health summary. Do not redesign the whole panel.

- [x] **Step 1: Write failing test** that given recent provider timeline events, panel lines include attempt id / failure class / provider id without raw URLs.

- [x] **Step 2: Implement `buildProviderAttemptTimelineLines(events): string[]`** and append from `buildDiagnosticsPanelLines`.

- [x] **Step 3: Update diagnostics guide with one paragraph on the new section.**

- [x] **Step 4: Commit**

```bash
git commit -m "feat(diagnostics): show bounded provider attempt timeline in panel"
```

---

### Task 12: Diagnostics export / trace retention (latest-10)

**Files:**

- Find existing export path via:

```bash
rg -n "export-diagnostics|DiagnosticsBundle|trace.*jsonl|latest" apps/cli/src/services/diagnostics apps/cli/src/app-shell
```

- Modify the export/write helper to prune older files after successful write
- Test: temp-dir unit test creating 12 fake exports and asserting 10 remain

- [x] **Step 1: Implement prune helper**

```ts
export async function pruneOldestFiles(dir: string, pattern: RegExp, keep: number): Promise<void> {
  // list, filter, sort by mtime desc, delete from index `keep` onward
}
```

- [x] **Step 2: Call after writing a new export/trace file.**

- [x] **Step 3: Commit**

```bash
git commit -m "fix(diagnostics): retain latest 10 export and trace files"
```

---

### Task 13: Error-shell hardening (bounded substitute for AppErrorBoundary)

**Files:**

- Modify: `apps/cli/src/app-shell/root-status-shells.tsx`
- Modify: `apps/cli/src/app-shell/root-content-shell.tsx`
- Modify: `apps/cli/src/domain/playback/playback-problem.ts` only if new scenarios needed
- Docs: update `.plans/v2-shell-and-reliability-hardening.md` status note pointing here
- Test: error shell render / scenario mapping tests

**Scope cap:** Do **not** invent a new React error-boundary architecture in this plan. Ensure uncaught playback/provider failures already mapped through `playbackProblem` → `ErrorShell` expose Retry + Esc/Back consistently, and that a thrown render error in a child still fails soft where Ink allows (optional thin `componentDidCatch` wrapper around root content **only if** a minimal pattern already exists or can be added in <50 LOC without new dependencies).

- [x] **Step 1: Audit current ErrorShell actions (Retry / Esc)** against `playback-problem.ts` scenarios; fill any missing primary action.

- [x] **Step 2: Add/adjust unit tests for `toErrorScenario` coverage of provider-empty / timeout / user-cancel.**

- [x] **Step 3: Document in v2 plan that full AppErrorBoundary remains deferred; this task closed the actionable gap.**

- [x] **Step 4: Commit**

```bash
git commit -m "fix(shell): harden ErrorShell recovery actions for provider failures"
```

---

## Phase 4 — Docs, Truth Index, Verification

### Task 14: Update plan truth and release notes

**Files:**

- Modify: `.plans/plan-implementation-truth.md`
- Modify: `.plans/kunai-playback-reliability-implementation.md` (P2 status)
- Modify: `.plans/provider-reliability-diagnostics-and-reporting.md` (timeline + retention follow-ups)
- Add changeset if user-facing: `.changeset/ad11-reliability-followup.md`

- [x] **Step 1: Add a truth-index row** for this plan with status Implemented / In progress.

- [x] **Step 2: Mark completed follow-ups in the source plans; leave explicit Non-Goals as deferred.**

- [x] **Step 3: Changeset (patch)** summarizing user-visible fixes: diagnostics YouTube probe restore, overlay preserve, honest inventory age, safer cache preserve, footer/help parity.

- [x] **Step 4: Commit**

```bash
git commit -m "docs: record ad11 reliability follow-up truth and changeset"
```

---

### Task 15: Final verification gate

- [ ] **Step 1: Run required checks**

```bash
bun run fmt
bun run lint
bun run typecheck
bun run test
```

- [ ] **Step 2: Optional build if release-facing**

```bash
bun run build
```

- [ ] **Step 3: Manual smoke checklist (do not automate)**

1. Open `/diagnostics` from command palette and from workflow — YouTube probe lines present after open.
2. Browse search “Dune” → open Settings → close → query still “Dune”.
3. Post-play press `o` once — tracks open once.
4. Force refresh with a dead cached HLS URL — does not silently continue; recovers or fails visibly.
5. Playing footer shows next/prev/source; `?` documents quality/refresh overflow.

- [ ] **Step 4: Push and open/update PR**

```bash
git push -u origin cursor/ad11-reliability-integration-a0e0
```

PR title suggestion: `fix: land ad11 reliability stack + follow-up hardening`

PR body must list: merge order, closed duplicate branch, P0 YouTube probe fix, shell-frame combine, remaining deferred Non-Goals.

---

## Execution Order Summary

```text
Phase 0  Task 0–2   Integrate ad11 PRs (close duplicate)
Phase 1  Task 3–5   P0 regressions (YouTube probe, cancellationReason, degraded fallback)
Phase 2  Task 6–9   Overlay effects, tests, cache identity, honesty polish
Phase 3  Task 10–13 Planned gaps (footer/help parity, timeline, retention, ErrorShell)
Phase 4  Task 14–15 Docs + verification
```

## Explicitly Deferred (do not sneak into this plan)

| Item                                                 | Why deferred                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Subtitle/source preference learning                  | Separate product/ML-ish feature; needs its own plan           |
| HLS user-config vs clean mpv benchmark               | Manual research; not a code fix                               |
| Full player actor / command queue promotion          | Architecture rewrite; high risk                               |
| Greenfield `AppErrorBoundary` + Error Phase redesign | Partially covered by Task 13; full v2 shell item stays parked |
| Live provider CI                                     | Hard boundary — keep opt-in                                   |

---

## Self-Review Checklist

- [x] Spec coverage: merge hygiene, YouTube probe, shell-frame combine, preserve/fallback polish, overlay effects/tests, cache key note, honesty polish, footer/GO parity, timeline, retention, ErrorShell, docs
- [x] No placeholder steps (TBD/TODO/“add tests later”)
- [x] Non-Goals prevent scope creep into learning/benchmarks/actor rewrite
- [x] Types introduced (`ResolveCancellationReasonRef`, `FallbackPickResult`, diagnostics overlay `youtubeProbe`) are used consistently in later tasks
