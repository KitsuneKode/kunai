# History Continue Reliability (Track A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Continue ranking, resume persistence, soft-fallback preference promotion, history stamps, provider recovery, history delete, mid-play episode pickers, shortcut chrome, and post-play posters share one trusted-progress policy so search-launched and continue-launched playback cannot diverge.

**Architecture:** Introduce pure `ProgressEngagePolicy` and `SoftFallbackPreferencePolicy` under `apps/cli/src/domain/playback/`. Thin adapters in PlaybackPhase, ledger, browse idle, provider-switch, history overlay, settings, title menu, keybindings, and post-play consume decisions without re-encoding 10s/30s thresholds. Soft hops stay session-scoped until engage; ledger/finalize stamps always carry `resolvedProviderId`.

**Tech Stack:** Bun, TypeScript, SQLite (`@kunai/storage` history repo), React/Ink shell, existing fake-player / unit harnesses under `apps/cli/test/`.

## Global Constraints

- Dual gates are locked: trusted progress **> 10s** = persist resume; trusted progress **> 30s** = engage (Continue / `last_watched_at` bump / soft-fallback preference promote).
- Stuck / did-not-start: trusted (or effective) progress ≈ 0 **and** `durationSeconds > 0` must not bump `last_watched_at`, must not engage, must not promote preferences, and must not overwrite a good prior resume with a zero stamp.
- Soft fallback remains allowed during resolve; do **not** call `persistTitleProviderPreference` at hop time; promote the soft winner only after engage.
- Explicit user provider switch remains durable immediately via existing `applyUserProviderSwitch`.
- History stamps: ledger start/checkpoint/finalize carry `providerId: resolvedProviderId` while soft hop is active.
- History delete: `x` = episode row (`deleteProgressByKey`); `Shift+X` = whole title (`deleteTitle`); confirm with `y` / cancel with `Esc`; no multi-select.
- Provider recovery: browse palette + Settings Storage + title-menu forget preference; **no** new `F` / `Shift+F` health-reset bindings (existing player/post-play `Shift+F` fallback chords stay fallback, not health reset).
- Legend glyphs: `⇧` for Shift, `⌃` for Ctrl; letter case follows the keybinding registry (stop destructive `.toLowerCase()` on registry chords in footer helpers).
- Track A order is mandatory: A1 → A2 → A3 → A4 → A5 → A6 → A7 (posters last).
- Use no live providers.
- Do not use `bun test` alone; use `bun run test` / `bun run --cwd apps/cli test:file -- …`.
- Do not use worktrees unless the parent session already created one via `using-git-worktrees`.
- Preserve unrelated working-tree paths (installer reference docs, release-note scripts, generated metadata) unless a task explicitly lists them.
- Track B (search filters) is out of scope for this plan.

---

### Task 1: Add ProgressEngagePolicy (dual gates + DNS)

**Files:**

- Create: `apps/cli/src/domain/playback/progress-engage-policy.ts`
- Create: `apps/cli/test/unit/domain/playback/progress-engage-policy.test.ts`

**Interfaces:**

```ts
export const PERSIST_RESUME_SECONDS = 10;
export const ENGAGE_SECONDS = 30;

export type ProgressEngageEvidence = {
  readonly trustedProgressSeconds: number;
  readonly durationSeconds: number;
  readonly suspectedDeadStream?: boolean;
  readonly endReason?: "quit" | "eof" | "error" | "abort";
  /** Wall/engaged seconds only used when trusted is 0 and completion paths need a fallback. */
  readonly watchedSeconds?: number;
};

export type ProgressEngageDecision = {
  readonly canPersistResume: boolean;
  readonly isEngaged: boolean;
  readonly isDidNotStart: boolean;
  /** True when engage crossed, or completion/EOF override completed cleanly. */
  readonly shouldBumpLastWatched: boolean;
};

export function isDidNotStartProgress(evidence: ProgressEngageEvidence): boolean;

export function evaluateProgressEngage(
  evidence: ProgressEngageEvidence,
  options?: {
    readonly reachedCompletionThreshold?: boolean;
  },
): ProgressEngageDecision;

export function trustedProgressFromPlaybackResult(result: {
  readonly lastTrustedProgressSeconds?: number;
  readonly watchedSeconds: number;
  readonly duration: number;
  readonly endReason: ProgressEngageEvidence["endReason"];
  readonly suspectedDeadStream?: boolean;
}): ProgressEngageEvidence;
```

- Consumes: nothing (pure domain).
- Produces: `PERSIST_RESUME_SECONDS`, `ENGAGE_SECONDS`, `evaluateProgressEngage`, `isDidNotStartProgress`, `trustedProgressFromPlaybackResult` for Tasks 2–4.

- [ ] **Step 1: Write the failing gate-matrix test**

```ts
import { describe, expect, test } from "bun:test";

import {
  ENGAGE_SECONDS,
  PERSIST_RESUME_SECONDS,
  evaluateProgressEngage,
  isDidNotStartProgress,
} from "@/domain/playback/progress-engage-policy";

describe("ProgressEngagePolicy", () => {
  test("exports locked dual-gate constants", () => {
    expect(PERSIST_RESUME_SECONDS).toBe(10);
    expect(ENGAGE_SECONDS).toBe(30);
  });

  test("persist gate requires trusted > 10s", () => {
    expect(
      evaluateProgressEngage({ trustedProgressSeconds: 10, durationSeconds: 600 }).canPersistResume,
    ).toBe(false);
    expect(
      evaluateProgressEngage({ trustedProgressSeconds: 11, durationSeconds: 600 }).canPersistResume,
    ).toBe(true);
  });

  test("engage gate requires trusted > 30s", () => {
    const mid = evaluateProgressEngage({ trustedProgressSeconds: 30, durationSeconds: 600 });
    expect(mid.isEngaged).toBe(false);
    expect(mid.shouldBumpLastWatched).toBe(false);

    const engaged = evaluateProgressEngage({ trustedProgressSeconds: 31, durationSeconds: 600 });
    expect(engaged.isEngaged).toBe(true);
    expect(engaged.shouldBumpLastWatched).toBe(true);
    expect(engaged.canPersistResume).toBe(true);
  });

  test("stuck ~0 with known duration is did-not-start", () => {
    const evidence = { trustedProgressSeconds: 0, durationSeconds: 1400 };
    expect(isDidNotStartProgress(evidence)).toBe(true);
    const decision = evaluateProgressEngage(evidence);
    expect(decision.isDidNotStart).toBe(true);
    expect(decision.canPersistResume).toBe(false);
    expect(decision.isEngaged).toBe(false);
    expect(decision.shouldBumpLastWatched).toBe(false);
  });

  test("completion override may bump last-watched without engage", () => {
    const decision = evaluateProgressEngage(
      { trustedProgressSeconds: 5, durationSeconds: 600, endReason: "eof" },
      { reachedCompletionThreshold: true },
    );
    expect(decision.shouldBumpLastWatched).toBe(true);
    expect(decision.isEngaged).toBe(false);
  });

  test("suspected dead stream at ~0 is did-not-start", () => {
    expect(
      isDidNotStartProgress({
        trustedProgressSeconds: 0,
        durationSeconds: 900,
        suspectedDeadStream: true,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run --cwd apps/cli test:file -- test/unit/domain/playback/progress-engage-policy.test.ts
```

Expected: FAIL with module not found / `evaluateProgressEngage` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
export const PERSIST_RESUME_SECONDS = 10;
export const ENGAGE_SECONDS = 30;

export type ProgressEngageEvidence = {
  readonly trustedProgressSeconds: number;
  readonly durationSeconds: number;
  readonly suspectedDeadStream?: boolean;
  readonly endReason?: "quit" | "eof" | "error" | "abort";
  readonly watchedSeconds?: number;
};

export type ProgressEngageDecision = {
  readonly canPersistResume: boolean;
  readonly isEngaged: boolean;
  readonly isDidNotStart: boolean;
  readonly shouldBumpLastWatched: boolean;
};

export function isDidNotStartProgress(evidence: ProgressEngageEvidence): boolean {
  return evidence.trustedProgressSeconds <= 0 && evidence.durationSeconds > 0;
}

export function evaluateProgressEngage(
  evidence: ProgressEngageEvidence,
  options?: { readonly reachedCompletionThreshold?: boolean },
): ProgressEngageDecision {
  const isDidNotStart = isDidNotStartProgress(evidence);
  const canPersistResume =
    !isDidNotStart && evidence.trustedProgressSeconds > PERSIST_RESUME_SECONDS;
  const isEngaged = !isDidNotStart && evidence.trustedProgressSeconds > ENGAGE_SECONDS;
  const shouldBumpLastWatched = isEngaged || options?.reachedCompletionThreshold === true;
  return { canPersistResume, isEngaged, isDidNotStart, shouldBumpLastWatched };
}

export function trustedProgressFromPlaybackResult(result: {
  readonly lastTrustedProgressSeconds?: number;
  readonly watchedSeconds: number;
  readonly duration: number;
  readonly endReason: ProgressEngageEvidence["endReason"];
  readonly suspectedDeadStream?: boolean;
}): ProgressEngageEvidence {
  return {
    trustedProgressSeconds: result.lastTrustedProgressSeconds ?? 0,
    durationSeconds: result.duration,
    suspectedDeadStream: result.suspectedDeadStream,
    endReason: result.endReason,
    watchedSeconds: result.watchedSeconds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run --cwd apps/cli test:file -- test/unit/domain/playback/progress-engage-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/progress-engage-policy.ts \
  apps/cli/test/unit/domain/playback/progress-engage-policy.test.ts
git commit -m "feat(playback): add ProgressEngagePolicy dual gates"
```

---

### Task 2: Wire persist / resume / Continue / last-watched to ProgressEngagePolicy

**Files:**

- Modify: `apps/cli/src/domain/playback/playback-history.ts`
- Modify: `apps/cli/src/domain/playback/playback-progress-policy.ts`
- Modify: `apps/cli/src/app-shell/browse-idle-context.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/continuation/playback-history-ledger.ts`
- Modify: `apps/cli/test/unit/domain/playback/playback-history.test.ts`
- Modify: `apps/cli/test/unit/domain/playback/playback-progress-policy.test.ts`
- Modify: `apps/cli/test/unit/app-shell/browse-idle-context.test.ts`
- Create: `apps/cli/test/unit/services/continuation/playback-history-ledger-engage.test.ts`

**Interfaces:**

```ts
// playback-history.ts — keep signature, change body to policy
export function shouldPersistHistory(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): boolean;

// browse-idle-context.ts — replace literal 30 with ENGAGE_SECONDS
import { ENGAGE_SECONDS } from "@/domain/playback/progress-engage-policy";
// entry.positionSeconds > ENGAGE_SECONDS

// PlaybackHistoryLedger — optional lastWatched omit when not engaged
finalize(input: {
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly completed: boolean;
  readonly providerId?: ProviderId;
  readonly posterUrl?: string;
  readonly bumpLastWatched?: boolean;
}): void;
```

- Consumes: Task 1 `evaluateProgressEngage`, `ENGAGE_SECONDS`, `PERSIST_RESUME_SECONDS`, `trustedProgressFromPlaybackResult`.
- Produces: call sites that no longer hard-code `10` / `30` for gate decisions; DNS finalize leaves prior `last_watched_at` alone.

- [ ] **Step 1: Write failing call-site tests**

Extend `playback-history.test.ts`:

```ts
test("shouldPersistHistory uses persist gate, not engage gate", () => {
  expect(
    shouldPersistHistory({
      watchedSeconds: 0,
      duration: 600,
      endReason: "quit",
      lastTrustedProgressSeconds: 11,
    }),
  ).toBe(true);
  expect(
    shouldPersistHistory({
      watchedSeconds: 0,
      duration: 600,
      endReason: "quit",
      lastTrustedProgressSeconds: 10,
    }),
  ).toBe(false);
});
```

Extend `playback-progress-policy.test.ts`:

```ts
test("isResumeProgressPoint rejects at persist gate boundary", () => {
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 10, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(0);
  expect(
    resumeSecondsFromProgressPoint(
      { positionSeconds: 11, durationSeconds: 600 },
      "credits-or-90-percent",
    ),
  ).toBe(11);
});
```

Extend `browse-idle-context.test.ts`:

```ts
test("Continue hero requires engage gate (>30s) and ignores DNS-short rows", async () => {
  const { idleContext } = await buildBrowseIdleContext(container as never, {
    preloadedHistory: {
      "tmdb:short": {
        key: "tmdb:short",
        titleId: "tmdb:short",
        title: "Too Short",
        season: 1,
        episode: 1,
        positionSeconds: 30,
        durationSeconds: 1200,
        completed: false,
        createdAt: "2026-07-21T09:00:00.000Z",
        updatedAt: "2026-07-21T10:00:00.000Z",
        mediaKind: "series",
      },
      "tmdb:engaged": {
        key: "tmdb:engaged",
        titleId: "tmdb:engaged",
        title: "Engaged Title",
        season: 1,
        episode: 2,
        positionSeconds: 31,
        durationSeconds: 1200,
        completed: false,
        createdAt: "2026-07-21T09:00:00.000Z",
        updatedAt: "2026-07-21T09:30:00.000Z",
        mediaKind: "series",
      },
    },
  });
  expect(idleContext?.continueWatching?.title).toBe("Engaged Title");
});
```

Add ledger engage test:

```ts
test("finalize without bumpLastWatched preserves existing lastWatchedAt", () => {
  // seed row with lastWatchedAt = OLD, position 400
  // ledger.finalize({ ..., bumpLastWatched: false, positionSeconds: 0, durationSeconds: 1400 })
  // expect getProgress(...).lastWatchedAt === OLD and position unchanged when DNS
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/playback/playback-history.test.ts \
  test/unit/domain/playback/playback-progress-policy.test.ts \
  test/unit/app-shell/browse-idle-context.test.ts \
  test/unit/services/continuation/playback-history-ledger-engage.test.ts
```

Expected: FAIL on Continue 30s boundary and/or ledger bump semantics.

- [ ] **Step 3: Implement wiring**

In `playback-history.ts`, replace `> 10` literals with policy:

```ts
import {
  evaluateProgressEngage,
  trustedProgressFromPlaybackResult,
} from "@/domain/playback/progress-engage-policy";

export function shouldPersistHistory(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): boolean {
  const completed = didPlaybackReachCompletionThreshold(result, timing, thresholdMode);
  const eofOverride =
    result.endReason === "eof" &&
    result.duration > 0 &&
    (result.lastTrustedProgressSeconds ?? 0) <= 0 &&
    result.suspectedDeadStream !== true;
  if (completed || eofOverride) return true;
  return evaluateProgressEngage(trustedProgressFromPlaybackResult(result)).canPersistResume;
}
```

In `playback-progress-policy.ts`, replace `positionSeconds <= 10` with `<= PERSIST_RESUME_SECONDS`.

In `browse-idle-context.ts`, replace `entry.positionSeconds > 30` with `entry.positionSeconds > ENGAGE_SECONDS`.

In `PlaybackPhase.ts` history save branch:

```ts
const evidence = trustedProgressFromPlaybackResult(result);
const decision = evaluateProgressEngage(evidence, {
  reachedCompletionThreshold: didComplete,
});
if (shouldPersistHistory(...)) {
  // upsert / ledger.finalize
  // pass bumpLastWatched: decision.shouldBumpLastWatched
  // if decision.isDidNotStart: do not overwrite a prior good resume position
}
```

In `PlaybackHistoryLedger.finalize` / `checkpoint`:

- Accept `bumpLastWatched?: boolean` (default `true` for backward compat in tests that already engage).
- When `bumpLastWatched === false`, omit `lastWatchedAt` from the upsert input (or pass the existing row's timestamp) so DNS does not poison ranking.
- Checkpoint mid-play: only bump when `lastPositionSeconds > ENGAGE_SECONDS`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/playback/progress-engage-policy.test.ts \
  test/unit/domain/playback/playback-history.test.ts \
  test/unit/domain/playback/playback-progress-policy.test.ts \
  test/unit/app-shell/browse-idle-context.test.ts \
  test/unit/services/continuation/playback-history-ledger-engage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/playback-history.ts \
  apps/cli/src/domain/playback/playback-progress-policy.ts \
  apps/cli/src/app-shell/browse-idle-context.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/src/services/continuation/playback-history-ledger.ts \
  apps/cli/test/unit/domain/playback/playback-history.test.ts \
  apps/cli/test/unit/domain/playback/playback-progress-policy.test.ts \
  apps/cli/test/unit/app-shell/browse-idle-context.test.ts \
  apps/cli/test/unit/services/continuation/playback-history-ledger-engage.test.ts
git commit -m "fix(playback): wire dual gates and DNS last-watched"
```

---

### Task 3: SoftFallbackPreferencePolicy + forget preference helper

**Files:**

- Create: `apps/cli/src/domain/playback/soft-fallback-preference-policy.ts`
- Create: `apps/cli/test/unit/domain/playback/soft-fallback-preference-policy.test.ts`
- Modify: `apps/cli/src/app/playback/playback-provider-switch.ts`
- Modify: `apps/cli/test/unit/app/playback-provider-switch.test.ts`

**Interfaces:**

```ts
export type SoftFallbackResolveDecision =
  { readonly kind: "no-hop" } | { readonly kind: "session-soft-hop"; readonly providerId: string };

export type SoftFallbackPromoteDecision =
  | { readonly kind: "leave-durable-unchanged" }
  | {
      readonly kind: "promote-durable";
      readonly providerId: string;
      readonly canonicalTitleId: string;
    };

export function decideSoftFallbackOnResolve(input: {
  readonly configuredProviderId: string;
  readonly resolvedProviderId: string;
}): SoftFallbackResolveDecision;

export function decideSoftFallbackPromote(input: {
  readonly sessionSoftProviderId: string | null;
  readonly configuredProviderId: string;
  readonly engaged: boolean;
  readonly canonicalTitleId: string;
}): SoftFallbackPromoteDecision;
```

Export from `playback-provider-switch.ts`:

```ts
export async function persistTitleProviderPreference(
  container: Pick<Container, "config">,
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  providerId: string,
  mode?: ShellMode,
): Promise<void>;

export async function clearTitleProviderPreference(
  container: Pick<Container, "config">,
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: ShellMode,
): Promise<boolean>;
```

- Consumes: Task 1 engage boolean; existing `resolveTitleHistoryLookupId`.
- Produces: promote/forget helpers for Task 4 and Task 5.

- [ ] **Step 1: Write failing policy + forget tests**

```ts
import { describe, expect, test } from "bun:test";

import {
  decideSoftFallbackOnResolve,
  decideSoftFallbackPromote,
} from "@/domain/playback/soft-fallback-preference-policy";

test("soft hop sets session soft only", () => {
  expect(
    decideSoftFallbackOnResolve({
      configuredProviderId: "allanime",
      resolvedProviderId: "miruro",
    }),
  ).toEqual({ kind: "session-soft-hop", providerId: "miruro" });
});

test("same provider is no-hop", () => {
  expect(
    decideSoftFallbackOnResolve({
      configuredProviderId: "allanime",
      resolvedProviderId: "allanime",
    }),
  ).toEqual({ kind: "no-hop" });
});

test("promote only after engage on soft winner", () => {
  expect(
    decideSoftFallbackPromote({
      sessionSoftProviderId: "miruro",
      configuredProviderId: "allanime",
      engaged: false,
      canonicalTitleId: "anilist:1",
    }),
  ).toEqual({ kind: "leave-durable-unchanged" });

  expect(
    decideSoftFallbackPromote({
      sessionSoftProviderId: "miruro",
      configuredProviderId: "allanime",
      engaged: true,
      canonicalTitleId: "anilist:1",
    }),
  ).toEqual({
    kind: "promote-durable",
    providerId: "miruro",
    canonicalTitleId: "anilist:1",
  });
});
```

In `playback-provider-switch.test.ts`:

```ts
test("clearTitleProviderPreference removes only the canonical title pin", async () => {
  const updates: Array<Partial<KitsuneConfig>> = [];
  const container = {
    config: {
      getRaw: () => ({
        titleProviderPreferences: {
          "anilist:1": "miruro",
          "anilist:2": "vidking",
        },
      }),
      update: async (partial: Partial<KitsuneConfig>) => {
        updates.push(partial);
      },
      save: async () => {},
    },
  };
  const cleared = await clearTitleProviderPreference(
    container as never,
    { id: "anilist:1", type: "series", isAnime: true },
    "anime",
  );
  expect(cleared).toBe(true);
  expect(updates.at(-1)?.titleProviderPreferences).toEqual({ "anilist:2": "vidking" });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/playback/soft-fallback-preference-policy.test.ts \
  test/unit/app/playback-provider-switch.test.ts
```

Expected: FAIL — policy module missing; `clearTitleProviderPreference` not exported.

- [ ] **Step 3: Implement policy + export persist/clear**

```ts
export function decideSoftFallbackOnResolve(input: {
  readonly configuredProviderId: string;
  readonly resolvedProviderId: string;
}): SoftFallbackResolveDecision {
  if (input.resolvedProviderId === input.configuredProviderId) {
    return { kind: "no-hop" };
  }
  return { kind: "session-soft-hop", providerId: input.resolvedProviderId };
}

export function decideSoftFallbackPromote(input: {
  readonly sessionSoftProviderId: string | null;
  readonly configuredProviderId: string;
  readonly engaged: boolean;
  readonly canonicalTitleId: string;
}): SoftFallbackPromoteDecision {
  if (!input.engaged || !input.sessionSoftProviderId) {
    return { kind: "leave-durable-unchanged" };
  }
  if (input.sessionSoftProviderId === input.configuredProviderId) {
    return { kind: "leave-durable-unchanged" };
  }
  return {
    kind: "promote-durable",
    providerId: input.sessionSoftProviderId,
    canonicalTitleId: input.canonicalTitleId,
  };
}
```

In `playback-provider-switch.ts`: change `persistTitleProviderPreference` from `async function` to `export async function`. Add:

```ts
export async function clearTitleProviderPreference(
  container: Pick<Container, "config">,
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: ShellMode,
): Promise<boolean> {
  const raw = container.config.getRaw();
  const canonicalId = resolveTitleHistoryLookupId(title, mode);
  const nextPrefs = { ...raw.titleProviderPreferences };
  let changed = false;
  if (canonicalId in nextPrefs) {
    delete nextPrefs[canonicalId];
    changed = true;
  }
  if (title.id !== canonicalId && title.id in nextPrefs) {
    delete nextPrefs[title.id];
    changed = true;
  }
  if (!changed) return false;
  await container.config.update({ titleProviderPreferences: nextPrefs });
  await container.config.save();
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/playback/soft-fallback-preference-policy.test.ts \
  test/unit/app/playback-provider-switch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/soft-fallback-preference-policy.ts \
  apps/cli/test/unit/domain/playback/soft-fallback-preference-policy.test.ts \
  apps/cli/src/app/playback/playback-provider-switch.ts \
  apps/cli/test/unit/app/playback-provider-switch.test.ts
git commit -m "feat(playback): soft-fallback preference policy and forget helper"
```

---

### Task 4: Promote after engage + align ledger provider stamps

**Files:**

- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/continuation/playback-history-ledger.ts`
- Create: `apps/cli/test/unit/services/continuation/playback-history-ledger-provider.test.ts`
- Create: `apps/cli/test/unit/app/playback/soft-fallback-promote.test.ts`

**Interfaces:**

```ts
// PlaybackHistoryLedger
alignProvider(providerId: ProviderId): void;

start(context: PlaybackHistoryLedgerContext, startAtSeconds: number): void;
// start context.providerId must be resolved / session-soft when hop already known
```

Promote call site (PlaybackPhase after history decision):

```ts
const promote = decideSoftFallbackPromote({
  sessionSoftProviderId: run.sessionSoftProviderId,
  configuredProviderId: currentProvider.metadata.id,
  engaged: decision.isEngaged,
  canonicalTitleId: resolveTitleHistoryLookupId(title, stateManager.getState().mode),
});
if (promote.kind === "promote-durable") {
  await persistTitleProviderPreference(container, title, promote.providerId, mode);
}
```

- Consumes: Tasks 1–3 policies; `persistTitleProviderPreference`; `sessionSoftProviderId` on `playback-run-state`.
- Produces: hop-before-engage leaves durable prefs unchanged; engage promotes; checkpoints stamp resolved provider.

- [ ] **Step 1: Write failing stamp + promote tests**

```ts
test("alignProvider updates checkpoint providerId", () => {
  ledger.start({ title, mediaKind: "anime", providerId: "allanime" }, 0);
  ledger.alignProvider("miruro");
  ledger.onProgress(45, 1400);
  ledger.checkpoint();
  expect(repo.getProgress(title)?.providerId).toBe("miruro");
});

test("soft hop before engage does not persist title preference", async () => {
  // Simulate: sessionSoftProviderId=miruro, trusted=15 → canPersistResume true, isEngaged false
  // Assert config.titleProviderPreferences unchanged
});

test("engage after soft hop promotes durable preference", async () => {
  // trusted=45, sessionSoft=miruro → titleProviderPreferences[canonical]=miruro
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/continuation/playback-history-ledger-provider.test.ts \
  test/unit/app/playback/soft-fallback-promote.test.ts
```

Expected: FAIL — `alignProvider` missing; promote not wired.

- [ ] **Step 3: Implement ledger align + PlaybackPhase wiring**

Add to `PlaybackHistoryLedger`:

```ts
alignProvider(providerId: ProviderId): void {
  if (!this.context) return;
  this.context = { ...this.context, providerId };
}
```

In PlaybackPhase soft-hop branch (where `run.sessionSoftProviderId = resolvedProviderId` is set today):

```ts
const hop = decideSoftFallbackOnResolve({
  configuredProviderId: currentProvider.metadata.id,
  resolvedProviderId,
});
if (hop.kind === "session-soft-hop") {
  run.sessionSoftProviderId = hop.providerId;
  this.playbackLedger?.alignProvider(hop.providerId);
  // existing session note copy stays
}
```

When starting the ledger (today uses `stateManager.getState().provider`), pass:

```ts
providerId: run.sessionSoftProviderId ?? resolvedProviderId ?? stateManager.getState().provider,
```

After engage decision on finalize path, call `decideSoftFallbackPromote` + `persistTitleProviderPreference` only when `promote.kind === "promote-durable"`. Never persist preference at hop time.

Keep finalize `providerId: resolvedProviderId` as today.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/continuation/playback-history-ledger-provider.test.ts \
  test/unit/app/playback/soft-fallback-promote.test.ts \
  test/unit/domain/playback/soft-fallback-preference-policy.test.ts \
  test/unit/app/playback/playback-run-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/src/services/continuation/playback-history-ledger.ts \
  apps/cli/test/unit/services/continuation/playback-history-ledger-provider.test.ts \
  apps/cli/test/unit/app/playback/soft-fallback-promote.test.ts
git commit -m "fix(playback): promote soft fallback only after engage"
```

---

### Task 5: Provider recovery surfaces (palette, Settings, forget preference)

**Files:**

- Modify: `apps/cli/src/app-shell/search-browse-command-ids.ts`
- Modify: `apps/cli/src/app-shell/settings/registry/storage.ts`
- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/title-control/title-control-actions.ts`
- Modify: `apps/cli/src/app-shell/title-control/open-title-control-menu.ts`
- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts`
- Modify: `apps/cli/src/domain/session/command-registry.ts` (only if `forget-title-provider-preference` needs a command id; prefer ShellAction-only if palette is not required)
- Create: `apps/cli/test/unit/app-shell/search-browse-command-ids.test.ts`
- Create: `apps/cli/test/unit/app-shell/settings-storage-reset-health.test.ts`
- Modify: `apps/cli/test/unit/app-shell/title-control-actions.test.ts` (create if missing)
- Modify: `apps/cli/test/unit/app-shell/keybindings-collision.test.ts`

**Interfaces:**

```ts
// types.ts ShellAction union adds:
| "forget-title-provider-preference"

// title-control-actions.ts TitleControlActionId adds:
| "forget-title-provider-preference"

// search-browse-command-ids.ts includes:
"reset-provider-health",
"clear-cache",
```

- Consumes: Task 3 `clearTitleProviderPreference`; existing `handleResetProviderHealth` / `handleClearCache`.
- Produces: discoverable recovery without new F/Shift+F health bindings.

- [ ] **Step 1: Write failing surface tests**

```ts
import { expect, test } from "bun:test";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { KEYBINDINGS } from "@/app-shell/keybindings";
import { storageSettingsRows } from "@/app-shell/settings/registry/storage";
import { buildTitleControlActions } from "@/app-shell/title-control/title-control-actions";

test("browse palette exposes provider recovery commands", () => {
  expect(SEARCH_BROWSE_COMMAND_IDS).toContain("reset-provider-health");
  expect(SEARCH_BROWSE_COMMAND_IDS).toContain("clear-cache");
});

test("Settings Storage includes reset provider health action", () => {
  const rows = storageSettingsRows({} as never);
  expect(rows.some((row) => row.id === "resetProviderHealth")).toBe(true);
});

test("title menu offers forget preference when a title is focused", () => {
  const actions = buildTitleControlActions({
    surface: "browse",
    hasTitle: true,
    titleName: "Demo",
    titleType: "series",
    hasTitleProviderPreference: true,
  } as never);
  expect(actions.some((a) => a.id === "forget-title-provider-preference")).toBe(true);
});

test("no new F or Shift+F binding for provider health reset", () => {
  const healthBindings = KEYBINDINGS.filter(
    (b) =>
      b.id.includes("reset-provider-health") ||
      b.commandId === "reset-provider-health" ||
      b.label.toLowerCase().includes("reset provider health"),
  );
  for (const binding of healthBindings) {
    expect(binding.chord.input?.toLowerCase() === "f").toBe(false);
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/search-browse-command-ids.test.ts \
  test/unit/app-shell/settings-storage-reset-health.test.ts \
  test/unit/app-shell/title-control-actions.test.ts \
  test/unit/app-shell/keybindings-collision.test.ts
```

Expected: FAIL — browse IDs / storage row / forget action missing.

- [ ] **Step 3: Implement surfaces**

`search-browse-command-ids.ts` — append `"reset-provider-health"` and `"clear-cache"` to `SEARCH_BROWSE_COMMAND_IDS` (handlers already exist in `shell-workflows.ts`).

`storage.ts` — add Danger Zone action:

```ts
{
  kind: "action",
  id: "resetProviderHealth",
  label: "Reset provider health",
  detail: "Forget local provider failure memory so auto-fallback can retry",
  tone: "danger",
  run: async (ctx) => {
    const { handleShellAction } = await import("../../workflows");
    await handleShellAction({ action: "reset-provider-health", container: ctx.container });
    return "Provider health reset.";
  },
},
```

Extend `TitleControlContext` with `hasTitleProviderPreference?: boolean`. Add action:

```ts
{
  id: "forget-title-provider-preference",
  label: "Forget preference for this title",
  detail: "Clear the sticky provider pin for this title only",
  group: "providers-data",
  shellAction: "forget-title-provider-preference",
  when: (ctx) =>
    ctx.hasTitle && ctx.hasTitleProviderPreference
      ? enabled()
      : disabled("No saved provider preference for this title"),
},
```

Wire `buildTitleControlContextFromContainer` to set `hasTitleProviderPreference` via `resolveTitleProviderPreferenceForTitle`.

Add ShellAction `"forget-title-provider-preference"` and workflow handler that calls `clearTitleProviderPreference` for `state.currentTitle` and sets a calm feedback note ("Forgot provider preference for …"). Do **not** add keybindings for F/Shift+F health reset.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/search-browse-command-ids.test.ts \
  test/unit/app-shell/settings-storage-reset-health.test.ts \
  test/unit/app-shell/title-control-actions.test.ts \
  test/unit/app-shell/keybindings-collision.test.ts \
  test/unit/app/playback-provider-switch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/search-browse-command-ids.ts \
  apps/cli/src/app-shell/settings/registry/storage.ts \
  apps/cli/src/app-shell/types.ts \
  apps/cli/src/app-shell/title-control/title-control-actions.ts \
  apps/cli/src/app-shell/title-control/open-title-control-menu.ts \
  apps/cli/src/app-shell/workflows/shell-workflows.ts \
  apps/cli/test/unit/app-shell/search-browse-command-ids.test.ts \
  apps/cli/test/unit/app-shell/settings-storage-reset-health.test.ts \
  apps/cli/test/unit/app-shell/title-control-actions.test.ts \
  apps/cli/test/unit/app-shell/keybindings-collision.test.ts
git commit -m "feat(shell): expose provider recovery without F hotkeys"
```

---

### Task 6: History delete UX (`x` / `⇧X` + confirm)

**Files:**

- Modify: `apps/cli/src/app-shell/use-history-overlay-input.ts`
- Modify: `apps/cli/src/app-shell/history-shell.tsx`
- Modify: `apps/cli/src/app-shell/keybindings.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (confirm state + idle Continue refresh)
- Modify: `apps/cli/test/unit/app-shell/use-history-overlay-input.test.ts`
- Create: `apps/cli/test/unit/app-shell/history-delete.test.ts`

**Interfaces:**

```ts
export type HistoryDeletePending =
  | { readonly kind: "episode"; readonly key: string; readonly label: string }
  | { readonly kind: "title"; readonly titleId: string; readonly label: string };

export type HistoryOverlayInputContext = {
  // existing fields…
  readonly pendingDelete: HistoryDeletePending | null;
  readonly setPendingDelete: (next: HistoryDeletePending | null) => void;
  readonly onHistoryMutated: () => void;
};
```

Keybindings (history scope):

```ts
{
  id: "history-delete-episode",
  chord: { input: "x" },
  label: "Delete episode progress",
  hintLabel: "delete ep",
  scope: "history",
  group: "History",
  footerPriority: 35,
},
{
  id: "history-delete-title",
  chord: { input: "X", shift: true },
  display: "⇧X",
  label: "Delete whole title from history",
  hintLabel: "delete title",
  scope: "history",
  group: "History",
  footerPriority: 36,
},
```

Repository calls (already exist):

```ts
container.historyRepository.deleteProgressByKey(key);
container.historyRepository.deleteTitle(titleId);
```

- Consumes: `RootHistorySelection.entry.key`, `deleteProgressByKey`, `deleteTitle`, Task 2 idle rebuild.
- Produces: confirm-gated delete that refreshes history projection and browse idle Continue.

- [ ] **Step 1: Write failing delete tests**

```ts
test("x arms episode delete confirm using progress key", () => {
  const setPendingDelete = mock();
  handleHistoryOverlayInput(
    "x",
    {},
    {
      ...baseCtx,
      pendingDelete: null,
      setPendingDelete,
      historySelections: [{ titleId: "tmdb:1", entry: { key: "tmdb:1:1:2", title: "Demo" } }],
    },
  );
  expect(setPendingDelete).toHaveBeenCalledWith({
    kind: "episode",
    key: "tmdb:1:1:2",
    label: expect.any(String),
  });
});

test("Shift+X arms title delete confirm", () => {
  // key.shift true, input "X" or "x"
});

test("y confirms episode delete via deleteProgressByKey only", () => {
  // pendingDelete kind episode → deleteProgressByKey called once; deleteTitle not called
});

test("Esc cancels without mutating", () => {
  // pendingDelete cleared; repo methods not called
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/use-history-overlay-input.test.ts \
  test/unit/app-shell/history-delete.test.ts
```

Expected: FAIL — delete chords unhandled.

- [ ] **Step 3: Implement input + chrome**

In `handleHistoryOverlayInput`:

1. If `pendingDelete` set: `y`/`Y` executes delete; `Esc` clears; ignore other letters.
2. Else if `input === "x"` and `!key.shift`: arm episode pending from `selected.entry.key`.
3. Else if `(input === "X" || input === "x") && key.shift`: arm title pending from `selected.titleId`.
4. On confirm: call the matching repository method, `setPendingDelete(null)`, `setOverlayStatus(...)`, `onHistoryMutated()` (redraw history + `buildBrowseIdleContext`).

In `history-shell.tsx` / root overlay: render confirm status like library delete (`Delete episode progress for …? y confirm · Esc cancel`). Register keybindings with `display: "⇧X"` for title delete. Do not implement multi-select.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/use-history-overlay-input.test.ts \
  test/unit/app-shell/history-delete.test.ts \
  test/unit/app-shell/keybindings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/use-history-overlay-input.ts \
  apps/cli/src/app-shell/history-shell.tsx \
  apps/cli/src/app-shell/keybindings.ts \
  apps/cli/src/app-shell/root-overlay-shell.tsx \
  apps/cli/test/unit/app-shell/use-history-overlay-input.test.ts \
  apps/cli/test/unit/app-shell/history-delete.test.ts
git commit -m "feat(history): add episode and title delete with confirm"
```

---

### Task 7: Mid-play episode picker parity (`animeEpisodes` + `previewBody`)

**Files:**

- Modify: `apps/cli/src/domain/session/SessionState.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/playback/playback-episode-picker.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Modify: `apps/cli/src/domain/types.ts` (optional: document synopsis on `EpisodePickerOption` if needed)
- Modify: `apps/cli/test/unit/app/playback-episode-picker.test.ts`
- Create: `apps/cli/test/unit/app-shell/open-active-playback-episode-picker.test.ts`

**Interfaces:**

```ts
// SessionState
readonly currentAnimeEpisodes: readonly EpisodePickerOption[] | null;

// Transition
| { type: "SET_CURRENT_ANIME_EPISODES"; episodes: readonly EpisodePickerOption[] | null }

// buildEpisodePickerOption / buildPlaybackEpisodePickerOptions
previewBody?: string; // set via formatEpisodePreviewSynopsis(overview | detail)

// openActivePlaybackEpisodePicker
const animeEpisodes = state.currentAnimeEpisodes ?? undefined;
await buildPlaybackEpisodePickerOptions({
  title,
  currentEpisode: pickerEpisode,
  isAnime,
  animeEpisodeCount: title.episodeCount,
  animeEpisodes,
  watchedEntries,
});
```

- Consumes: existing `buildPlaybackEpisodePickerOptions({ animeEpisodes })`; `formatEpisodePreviewSynopsis` from `apps/cli/src/services/catalog/episode-display.ts`; PlaybackPhase `getAnimeEpisodeOptions`.
- Produces: mid-play anime picker labels/preview parity with pre-play path.

- [ ] **Step 1: Write failing parity tests**

```ts
test("anime path prefers animeEpisodes labels over numbered stubs", async () => {
  const options = await buildPlaybackEpisodePickerOptions({
    title: seriesTitle,
    currentEpisode: { season: 1, episode: 2 },
    isAnime: true,
    animeEpisodeCount: 12,
    animeEpisodes: [
      { index: 1, label: "Episode 1 · Beginnings", detail: "Air date", name: "Beginnings" },
      { index: 2, label: "Episode 2 · Rising", detail: "Air date", name: "Rising" },
    ],
  });
  expect(options.options[1]?.label).toContain("Rising");
  expect(options.options[1]?.label).not.toBe("Episode 2");
});

test("buildEpisodePickerOption forwards previewBody synopsis", () => {
  const option = buildEpisodePickerOption({
    season: 1,
    episode: 1,
    label: "Episode 1",
    baseDetail: "meta",
    previewBody: "A long synopsis for the preview rail.",
    current: true,
  });
  expect(option.previewBody).toBe("A long synopsis for the preview rail.");
});

test("openActivePlaybackEpisodePicker passes session currentAnimeEpisodes", async () => {
  // mock state.currentAnimeEpisodes with two named entries
  // spy buildPlaybackEpisodePickerOptions args.animeEpisodes length === 2
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback-episode-picker.test.ts \
  test/unit/app-shell/open-active-playback-episode-picker.test.ts
```

Expected: FAIL — `previewBody` omitted; mid-play path does not pass `animeEpisodes`.

- [ ] **Step 3: Implement**

1. Add `currentAnimeEpisodes` to `SessionState` (default `null`); clear on title clear / playback end; set via `SET_CURRENT_ANIME_EPISODES` when PlaybackPhase resolves `currentAnimeEpisodes`.
2. In `openActivePlaybackEpisodePicker`, pass `animeEpisodes: state.currentAnimeEpisodes ?? undefined`.
3. Extend `buildEpisodePickerOption` to accept `previewBody?: string` and set it on the shell option. When mapping `animeEpisodes`, set `previewBody: formatEpisodePreviewSynopsis(entry.name ? entry.detail : entry.detail)` — prefer synopsis fields when providers supply overview-like text in `detail`/`name`; for TMDB path keep existing `formatEpisodePreviewSynopsis(episode.overview)`.
4. When `animeEpisodes` is empty/undefined, keep count-based fallback (no fake titles).
5. Leave non-anime TMDB season hop in `openActivePlaybackEpisodePicker` unchanged (`if (isAnime) continue` on switch-season).

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback-episode-picker.test.ts \
  test/unit/app-shell/open-active-playback-episode-picker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/session/SessionState.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/src/app/playback/playback-episode-picker.ts \
  apps/cli/src/app-shell/ink-shell.tsx \
  apps/cli/test/unit/app/playback-episode-picker.test.ts \
  apps/cli/test/unit/app-shell/open-active-playback-episode-picker.test.ts
git commit -m "fix(shell): pass anime episodes into mid-play picker"
```

---

### Task 8: Shortcut chrome glyphs + text/confirm focus isolation

**Files:**

- Modify: `apps/cli/src/app-shell/keybindings.ts` (`formatChord`, `footerKeyFromBinding`)
- Modify: `apps/cli/src/app-shell/loading-shell-model.ts`
- Modify: `apps/cli/src/app-shell/title-control/title-control-post-play.ts`
- Modify: `apps/cli/src/app-shell/post-play-view.ts`
- Modify: `apps/cli/src/app-shell/playback-session-key-hints.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (history confirm focus ownership)
- Modify: `apps/cli/test/unit/app-shell/keybindings.test.ts`
- Create: `apps/cli/test/unit/app-shell/browse-focus-isolation.test.ts`

**Interfaces:**

```ts
/** Human-readable chord using locked glyphs: ⇧ Shift, ⌃ Ctrl. */
export function formatChord(chord: KeyChord): string;

export function footerKeyFromBinding(binding: KeyBinding): string;
// Uses binding.display when set; otherwise formatChord without blanket toLowerCase()
// that erases registry case for letter chords like x / ⇧X.
```

- Consumes: Task 6 history delete bindings (`x`, `⇧X`).
- Produces: legend/footer consistency; confirm/`y` does not type into browse search; letter hotkeys suppressed while text/command input owns focus.

- [ ] **Step 1: Write failing chrome + focus tests**

```ts
test("formatChord uses glyphs for shift and ctrl", () => {
  expect(formatChord({ input: "x", shift: true })).toBe("⇧X");
  expect(formatChord({ input: "c", ctrl: true })).toBe("⌃C");
});

test("footerKeyFromBinding preserves registry letter case for history delete", () => {
  const episode = KEYBINDINGS.find((b) => b.id === "history-delete-episode")!;
  const title = KEYBINDINGS.find((b) => b.id === "history-delete-title")!;
  expect(footerKeyFromBinding(episode)).toBe("x");
  expect(footerKeyFromBinding(title)).toBe("⇧X");
});

test("history confirm y does not fall through to browse search editor", () => {
  // With pendingDelete set and history overlay focused, input "y" is handled by
  // history overlay and must not append to browse query string.
});

test("letter hotkeys are ignored while command/text input owns focus", () => {
  // commandMode or query-focused: bare "e" / "h" do not dispatch shell actions
  // (Ctrl+C, "/", Esc still work per ux-architecture).
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/keybindings.test.ts \
  test/unit/app-shell/browse-focus-isolation.test.ts
```

Expected: FAIL — still renders `Shift+X` / `Ctrl+C`; footers lower-case chords.

- [ ] **Step 3: Implement formatter + call-site cleanup + focus guards**

Update `formatChord`:

```ts
export function formatChord(chord: KeyChord): string {
  const modifiers: string[] = [];
  if (chord.ctrl) modifiers.push("⌃");
  if (chord.meta) modifiers.push("Alt");
  if (chord.shift) modifiers.push("⇧");
  const base = chord.named
    ? (NAMED_LABELS[chord.named] ?? chord.named)
    : formatPrintable(chord.input ?? "", modifiers.length > 0);
  return [...modifiers, base].join("");
}
```

Keep `formatPrintable` uppercasing single letters when modifiers are present so `⇧` + `x` → `⇧X`.

Update `footerKeyFromBinding` to return `binding.display ?? formatChord(binding.chord)` without `.toLowerCase()`, except named `return` → `enter`.

Replace local `formatChord(...).toLowerCase()` in `loading-shell-model.ts`, `title-control-post-play.ts`, `post-play-view.ts` with `footerKeyFromBinding` / shared helper.

In browse/root overlay input routing:

- While history `pendingDelete` is set, route keys only to `handleHistoryOverlayInput`.
- While browse search line or command palette owns focus, suppress bare letter shell hotkeys; keep Tab calendar cycling when calendar is focused; keep Ctrl+C, `/`, Esc.

Update existing `formatChord` expectations in `keybindings.test.ts` (`Ctrl+C` → `⌃C`, etc.).

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/keybindings.test.ts \
  test/unit/app-shell/keybindings-collision.test.ts \
  test/unit/app-shell/browse-focus-isolation.test.ts \
  test/unit/app-shell/history-delete.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/keybindings.ts \
  apps/cli/src/app-shell/loading-shell-model.ts \
  apps/cli/src/app-shell/title-control/title-control-post-play.ts \
  apps/cli/src/app-shell/post-play-view.ts \
  apps/cli/src/app-shell/playback-session-key-hints.ts \
  apps/cli/src/app-shell/browse-shell.tsx \
  apps/cli/src/app-shell/root-overlay-shell.tsx \
  apps/cli/test/unit/app-shell/keybindings.test.ts \
  apps/cli/test/unit/app-shell/browse-focus-isolation.test.ts
git commit -m "fix(shell): glyph legends and text-focus isolation"
```

---

### Task 9: Post-play recs / MiniPosterTile reliability (last)

**Files:**

- Modify: `apps/cli/src/app-shell/post-play-shell.tsx`
- Modify: `apps/cli/src/app-shell/primitives/MiniPosterTile.tsx`
- Modify: `apps/cli/src/app/post-play/post-playback-recommendations.ts`
- Modify: `apps/cli/src/app/playback/run-post-playback-menu.ts` (seed/ready race only if needed)
- Create: `apps/cli/test/unit/app-shell/mini-poster-tile.test.tsx`
- Create: `apps/cli/test/unit/app/post-play/post-playback-recommendations-ready.test.ts`

**Interfaces:**

```ts
// MiniPosterTile props remain:
{
  readonly url?: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly rows?: number;
  readonly cols?: number;
  readonly debounceMs?: number;
  readonly placeholderColor?: string;
}

// seedPostPlaybackRecommendationItems already:
seedPostPlaybackRecommendationItems({
  enabled: boolean;
  currentTitle: string;
  prefetchedItems: readonly SearchResult[] | null;
}): readonly PostPlaybackRecommendationItem[];
```

- Consumes: Tasks 1–2 trustworthy Continue/`last_watched_at` stamps (no poisoned ranking feeding rails).
- Produces: posters render when URLs exist; missing posters degrade to initials; empty-seed race surfaces items when background load completes.

- [ ] **Step 1: Write failing presentation tests**

```ts
test("MiniPosterTile falls back to initials when url missing", () => {
  // render MiniPosterTile with url undefined, title "Attack on Titan"
  // assert initials "AT" (or "Ao") appear and no throw
});

test("recommendation seed returns items when prefetch arrives after empty start", () => {
  expect(
    seedPostPlaybackRecommendationItems({
      enabled: true,
      currentTitle: "Current",
      prefetchedItems: null,
    }),
  ).toEqual([]);

  const items = seedPostPlaybackRecommendationItems({
    enabled: true,
    currentTitle: "Current",
    prefetchedItems: [
      {
        id: "tmdb:9",
        type: "series",
        title: "Neighbor",
        posterPath: "/p.jpg",
      } as never,
    ],
  });
  expect(items).toHaveLength(1);
  expect(items[0]?.title).toBe("Neighbor");
});

test("post-play discovery cards keep posterUrl through ready transition", () => {
  // Assert rail model maps posterPath → posterUrl and survives empty→ready update
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/mini-poster-tile.test.tsx \
  test/unit/app/post-play/post-playback-recommendations-ready.test.ts
```

Expected: FAIL on ready-race / missing safe fallback if gaps exist; otherwise tighten assertions until a real gap fails, then fix.

- [ ] **Step 3: Implement presentation polish only**

- Ensure `DiscoveryCard` / list layout always pass `url={card.posterUrl}` and `enabled` only when imaging is available; never throw when `usePosterPreview` returns `kind: "none"`.
- If post-play menu drops background-loaded recommendations when the first seed was empty, wire the existing `background` load path in `post-playback-recommendations.ts` / `run-post-playback-menu.ts` so the rail re-renders when items arrive (no new recommendation algorithm).
- Do not change Continue ranking or preference policy in this task.

- [ ] **Step 4: Run focused + Track A regression gate**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/mini-poster-tile.test.tsx \
  test/unit/app/post-play/post-playback-recommendations-ready.test.ts \
  test/unit/domain/playback/progress-engage-policy.test.ts \
  test/unit/domain/playback/soft-fallback-preference-policy.test.ts \
  test/unit/app-shell/browse-idle-context.test.ts \
  test/unit/app-shell/history-delete.test.ts \
  test/unit/app-shell/keybindings.test.ts
bun run typecheck
bun run lint
bun run fmt
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/post-play-shell.tsx \
  apps/cli/src/app-shell/primitives/MiniPosterTile.tsx \
  apps/cli/src/app/post-play/post-playback-recommendations.ts \
  apps/cli/src/app/playback/run-post-playback-menu.ts \
  apps/cli/test/unit/app-shell/mini-poster-tile.test.tsx \
  apps/cli/test/unit/app/post-play/post-playback-recommendations-ready.test.ts
git commit -m "fix(post-play): harden recommendation poster rails"
```
