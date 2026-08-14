# Playback Screen And Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the playback screen calmer, separate intentional provider changes from recovery fallback, expose stream/language choices cleanly, and make playback errors fail fast or recover with structured user-facing guidance.

**Architecture:** Introduce a dedicated recovery command/action and a structured playback problem model. Keep provider switching as an intentional picker, move fallback provider use behind recovery policy, and collapse source/quality/audio/subtitle selection into a stream-oriented picker surface. UI should render command availability from state, not from hardcoded long shortcut strings.

**Tech Stack:** Bun, TypeScript, Ink, mpv Lua bridge, existing command registry, `PlayerControlService`, `PlaybackPhase`, diagnostics store, Bun test runner via `bun run test`.

---

## File Structure

- Modify `apps/cli/src/domain/session/command-registry.ts`: add `recover` and `streams` command semantics; keep `provider` as intentional provider picker.
- Modify `apps/cli/src/infra/player/PlayerControlService.ts`: add `recover` playback control action and service method.
- Modify `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`: implement recovery stop action without treating provider as fallback.
- Modify `apps/cli/src/infra/player/playback-failure-classifier.ts`: replace direct fallback guidance with staged recovery guidance.
- Create `apps/cli/src/domain/playback/playback-problem.ts`: structured problem type and helpers.
- Modify `apps/cli/src/app/PlaybackPhase.ts`: create and dispatch structured playback problems for provider and player failures; consume `recover` action.
- Modify `apps/cli/src/app-shell/ink-shell.tsx`: reduce playback footer/control hints; stop mapping `provider` to fallback.
- Modify `apps/cli/src/app-shell/command-router.ts`: route `recover`, `streams`, `source`, `quality`, and `provider` according to state.
- Modify `apps/cli/src/app/source-quality.ts`: add combined stream picker option builder using source, quality, audio, and subtitle metadata.
- Test `apps/cli/test/unit/domain/session/SessionState.test.ts` or create `apps/cli/test/unit/domain/session/command-registry.test.ts`: command availability.
- Test `apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts`: recovery action recording and stop behavior.
- Test `apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts`: staged recovery guidance.
- Test `apps/cli/test/unit/app/source-quality.test.ts`: combined stream picker rows.
- Test `apps/cli/test/unit/app/playback-problem.test.ts`: structured problem mapping.

## Task 1: Command Semantics

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Create: `apps/cli/test/unit/domain/session/command-registry.test.ts`

- [ ] **Step 1: Write failing command tests**

Create `apps/cli/test/unit/domain/session/command-registry.test.ts` with tests proving:

```ts
import { describe, expect, test } from "bun:test";

import { COMMANDS, parseCommand, resolveCommands } from "@/domain/session/command-registry";
import { createInitialSessionState } from "@/domain/session/SessionState";

describe("command registry playback commands", () => {
  test("has recover and streams commands", () => {
    expect(COMMANDS.some((command) => command.id === "recover")).toBe(true);
    expect(COMMANDS.some((command) => command.id === "streams")).toBe(true);
    expect(parseCommand("/recover")?.id).toBe("recover");
    expect(parseCommand("/fix")?.id).toBe("recover");
    expect(parseCommand("/streams")?.id).toBe("streams");
  });

  test("provider remains an intentional provider picker", () => {
    expect(parseCommand("/provider")?.id).toBe("provider");
    expect(parseCommand("/fallback")).toBeNull();
  });

  test("streams is disabled until stream candidates exist", () => {
    const state = createInitialSessionState();
    const commands = resolveCommands(state, ["streams"]);
    expect(commands[0]?.enabled).toBe(false);
    expect(commands[0]?.reason).toContain("No stream choices");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/cli/test/unit/domain/session/command-registry.test.ts
```

Expected: fails because `recover` and `streams` are not valid command IDs yet.

- [ ] **Step 3: Add commands**

Update `AppCommandId` in `command-registry.ts` to include:

```ts
| "recover"
| "streams"
```

Add command entries:

```ts
{
  id: "recover",
  label: "Recover Playback",
  aliases: ["recover", "fix", "repair", "retry-playback"],
  description: "Run the safest recovery action for the current playback problem",
},
{
  id: "streams",
  label: "Streams",
  aliases: ["streams", "stream", "variants", "sources"],
  description: "Choose source, quality, audio, or subtitle stream details",
},
```

Update command state so `streams` is enabled only when `state.stream?.providerResolveResult?.streams.length` is positive. Update `recover` so it is enabled when playback is loading, buffering, stalled, seeking, playing, or error.

- [ ] **Step 4: Run command tests**

Run:

```bash
bun run test apps/cli/test/unit/domain/session/command-registry.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/session/command-registry.ts apps/cli/test/unit/domain/session/command-registry.test.ts
git commit -m "Add playback recovery commands"
```

## Task 2: Player Control Recovery Action

**Files:**

- Modify: `apps/cli/src/infra/player/PlayerControlService.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`
- Modify: `apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts`

- [ ] **Step 1: Write failing service test**

Add a test to `PlayerControlServiceImpl.test.ts` proving `recoverCurrentPlayback()` records `recover` as the last action and stops the player with an OSD message.

```ts
test("recoverCurrentPlayback stops active playback with recover action", async () => {
  const service = createService();
  const stopCalls: string[] = [];
  service.setActive({
    id: "test-player",
    stop: async (reason) => {
      stopCalls.push(reason ?? "");
    },
    showOsdMessage: async () => {},
  });

  const stopped = await service.recoverCurrentPlayback("unit-test");

  expect(stopped).toBe(true);
  expect(service.consumeLastAction()).toBe("recover");
  expect(stopCalls).toEqual(["unit-test"]);
});
```

- [ ] **Step 2: Run focused test to verify failure**

```bash
bun run test apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts
```

Expected: fails because `recoverCurrentPlayback` does not exist.

- [ ] **Step 3: Add interface and implementation**

In `PlayerControlService.ts`, add:

```ts
| "recover"
```

to `PlaybackControlAction`, and add:

```ts
recoverCurrentPlayback(reason?: string): Promise<boolean>;
```

In `PlayerControlServiceImpl.ts`, update the OSD label mapper:

```ts
case "recover":
  return "Kunai · Recovering playback…";
```

Add:

```ts
async recoverCurrentPlayback(reason = "user-requested"): Promise<boolean> {
  this.lastAction = "recover";
  return this.stopWithAction("recover", reason, true);
}
```

- [ ] **Step 4: Run focused test**

```bash
bun run test apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/infra/player/PlayerControlService.ts apps/cli/src/infra/player/PlayerControlServiceImpl.ts apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts
git commit -m "Add playback recover control action"
```

## Task 3: Structured Playback Problem Model

**Files:**

- Create: `apps/cli/src/domain/playback/playback-problem.ts`
- Create: `apps/cli/test/unit/app/playback-problem.test.ts`

- [ ] **Step 1: Write failing problem tests**

Create `apps/cli/test/unit/app/playback-problem.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  buildProviderResolveProblem,
  buildPlayerFailureProblem,
} from "@/domain/playback/playback-problem";

describe("playback problem model", () => {
  test("maps missing chromium to blocking setup problem", () => {
    const problem = buildProviderResolveProblem({
      attempts: [],
      capabilitySnapshot: { chromiumForEmbeds: false },
    });

    expect(problem.stage).toBe("provider-resolve");
    expect(problem.severity).toBe("blocking");
    expect(problem.recommendedAction).toBe("diagnostics");
    expect(problem.userMessage).toContain("Playwright Chromium");
  });

  test("maps player exit to relaunch before provider fallback", () => {
    const problem = buildPlayerFailureProblem("player-exited");

    expect(problem.stage).toBe("mpv");
    expect(problem.recommendedAction).toBe("relaunch");
    expect(problem.secondaryActions).toContain("try-next-provider");
  });
});
```

- [ ] **Step 2: Run problem tests to verify failure**

```bash
bun run test apps/cli/test/unit/app/playback-problem.test.ts
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement model**

Create `apps/cli/src/domain/playback/playback-problem.ts`:

```ts
import type { PlaybackFailureClass } from "@/infra/player/playback-failure-classifier";

export type PlaybackProblemStage =
  "provider-resolve" | "stream-open" | "mpv" | "subtitle" | "history";

export type PlaybackProblemSeverity = "info" | "recoverable" | "blocking";

export type PlaybackProblemAction =
  "wait" | "refresh" | "pick-stream" | "relaunch" | "try-next-provider" | "diagnostics";

export interface PlaybackProblem {
  readonly stage: PlaybackProblemStage;
  readonly severity: PlaybackProblemSeverity;
  readonly cause: string;
  readonly userMessage: string;
  readonly recommendedAction: PlaybackProblemAction;
  readonly secondaryActions: readonly PlaybackProblemAction[];
  readonly diagnosticId?: string;
}

export function buildProviderResolveProblem({
  attempts,
  capabilitySnapshot,
}: {
  attempts: readonly {
    readonly failure?: { readonly code?: string; readonly message?: string } | undefined;
  }[];
  capabilitySnapshot: { readonly chromiumForEmbeds: boolean } | null;
}): PlaybackProblem {
  if (!capabilitySnapshot?.chromiumForEmbeds) {
    return {
      stage: "provider-resolve",
      severity: "blocking",
      cause: "missing-chromium",
      userMessage:
        "Playwright Chromium is not installed. Install it before embed providers can resolve streams.",
      recommendedAction: "diagnostics",
      secondaryActions: [],
    };
  }

  const failureMessages = attempts
    .map((attempt) => attempt.failure?.message ?? "")
    .filter(Boolean)
    .join(" ");

  if (/net::|ERR_INTERNET|network|ECONNREFUSED|ETIMEDOUT/i.test(failureMessages)) {
    return {
      stage: "provider-resolve",
      severity: "recoverable",
      cause: "network",
      userMessage: "Network error while resolving the stream.",
      recommendedAction: "refresh",
      secondaryActions: ["try-next-provider", "diagnostics"],
    };
  }

  if (/timeout|timed out/i.test(failureMessages)) {
    return {
      stage: "provider-resolve",
      severity: "recoverable",
      cause: "provider-timeout",
      userMessage: "The provider timed out while resolving the stream.",
      recommendedAction: "refresh",
      secondaryActions: ["try-next-provider", "diagnostics"],
    };
  }

  return {
    stage: "provider-resolve",
    severity: "recoverable",
    cause: "no-stream",
    userMessage: "No playable stream was found from the available provider attempts.",
    recommendedAction: "pick-stream",
    secondaryActions: ["try-next-provider", "diagnostics"],
  };
}

export function buildPlayerFailureProblem(failureClass: PlaybackFailureClass): PlaybackProblem {
  switch (failureClass) {
    case "network-buffering":
      return {
        stage: "mpv",
        severity: "info",
        cause: "network-buffering",
        userMessage: "The stream is buffering while mpv fills its cache.",
        recommendedAction: "wait",
        secondaryActions: ["refresh", "diagnostics"],
      };
    case "expired-stream":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "expired-stream",
        userMessage: "The stream URL or segment lease may have expired.",
        recommendedAction: "refresh",
        secondaryActions: ["pick-stream", "try-next-provider", "diagnostics"],
      };
    case "seek-stuck":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "seek-stuck",
        userMessage: "mpv got stuck while seeking.",
        recommendedAction: "refresh",
        secondaryActions: ["relaunch", "diagnostics"],
      };
    case "ipc-stuck":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "ipc-stuck",
        userMessage: "Kunai lost reliable control of mpv.",
        recommendedAction: "relaunch",
        secondaryActions: ["diagnostics"],
      };
    case "player-exited":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "player-exited",
        userMessage: "mpv exited before Kunai could confirm normal playback completion.",
        recommendedAction: "relaunch",
        secondaryActions: ["try-next-provider", "diagnostics"],
      };
    case "unknown":
      return {
        stage: "mpv",
        severity: "recoverable",
        cause: "unknown",
        userMessage: "Playback ended for an unclear reason.",
        recommendedAction: "diagnostics",
        secondaryActions: ["refresh", "relaunch"],
      };
    case "none":
      return {
        stage: "mpv",
        severity: "info",
        cause: "none",
        userMessage: "No playback problem detected.",
        recommendedAction: "wait",
        secondaryActions: [],
      };
  }
}
```

- [ ] **Step 4: Run problem tests**

```bash
bun run test apps/cli/test/unit/app/playback-problem.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/playback-problem.ts apps/cli/test/unit/app/playback-problem.test.ts
git commit -m "Add structured playback problem model"
```

## Task 4: Recovery Policy Guidance

**Files:**

- Modify: `apps/cli/src/infra/player/playback-failure-classifier.ts`
- Create: `apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts`

- [ ] **Step 1: Write failing guidance tests**

Create `apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { recoveryForPlaybackFailure } from "@/infra/player/playback-failure-classifier";

describe("playback recovery guidance", () => {
  test("player exit recommends relaunch before provider fallback", () => {
    const guidance = recoveryForPlaybackFailure("player-exited");

    expect(guidance.action).toBe("relaunch");
    expect(guidance.label).toContain("relaunch");
    expect(guidance.label).not.toContain("fallback provider");
  });

  test("expired stream recommends refresh", () => {
    expect(recoveryForPlaybackFailure("expired-stream").action).toBe("refresh");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts
```

Expected: fails because `player-exited` currently recommends fallback.

- [ ] **Step 3: Update guidance**

Change `PlaybackRecoveryGuidance.action` to remove direct fallback:

```ts
readonly action: "none" | "wait" | "refresh" | "pick-stream" | "relaunch" | "inspect";
```

Update `player-exited`:

```ts
case "player-exited":
  return {
    action: "relaunch",
    label: "Relaunch mpv from the last trusted position; try another provider only if relaunch fails.",
  };
```

- [ ] **Step 4: Run guidance tests**

```bash
bun run test apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/infra/player/playback-failure-classifier.ts apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts
git commit -m "Prefer staged playback recovery guidance"
```

## Task 5: Combined Streams Picker

**Files:**

- Modify: `apps/cli/src/app/source-quality.ts`
- Modify: `apps/cli/test/unit/app/source-quality.test.ts`

- [ ] **Step 1: Write failing picker test**

Add a test proving stream options include source, quality, audio, and subtitle/hardsub facts in one row:

```ts
test("buildStreamPickerOptions combines source quality audio and subtitle details", () => {
  const stream = createPreparedStreamFixture({
    selectedStreamId: "stream-1080-en",
    providerResolveResult: {
      providerId: "vidking",
      selectedStreamId: "stream-1080-en",
      selectedSourceId: "server-2",
      sources: [
        { id: "server-2", label: "Server 2", host: "vid", kind: "embed", status: "selected" },
      ],
      streams: [
        {
          id: "stream-1080-en",
          url: "https://example.test/master.m3u8",
          sourceId: "server-2",
          qualityLabel: "1080p",
          qualityRank: 1080,
          audioLanguage: "en",
          subtitleLanguage: "en",
          hardsubLanguage: null,
        },
      ],
      subtitles: [],
      trace: [],
      cachePolicy: "volatile",
    },
  });

  const options = buildStreamPickerOptions(stream);

  expect(options).toHaveLength(1);
  expect(options[0]?.label).toContain("Server 2");
  expect(options[0]?.label).toContain("1080p");
  expect(options[0]?.detail).toContain("audio en");
  expect(options[0]?.detail).toContain("subs en");
});
```

- [ ] **Step 2: Run source-quality tests to verify failure**

```bash
bun run test apps/cli/test/unit/app/source-quality.test.ts
```

Expected: fails because `buildStreamPickerOptions` does not exist.

- [ ] **Step 3: Implement picker builder**

Add `buildStreamPickerOptions(stream)` to `source-quality.ts`. It should:

- Prefer `providerResolveResult.streams`.
- Use `source.label ?? source.host ?? source.id` for source label.
- Use `qualityLabel ?? container ?? id` for variant label.
- Include `audioLanguage`, `subtitleLanguage`, and `hardsubLanguage` in detail only when present.
- Mark the selected stream with `· current`.
- Sort by selected first, then quality rank descending.

- [ ] **Step 4: Run source-quality tests**

```bash
bun run test apps/cli/test/unit/app/source-quality.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app/source-quality.ts apps/cli/test/unit/app/source-quality.test.ts
git commit -m "Add combined playback stream picker options"
```

## Task 6: Playback Phase Recovery Flow

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/playback-session-controller.ts`
- Test: existing playback policy and session-controller tests

- [ ] **Step 1: Add failing tests around recovery routing**

Extend the playback session/controller tests to prove:

```ts
expect(createPlaybackSessionDecision({ controlAction: "recover" }).shouldFallbackProvider).toBe(
  false,
);
```

and:

```ts
expect(createPlaybackSessionDecision({ controlAction: "fallback" }).shouldFallbackProvider).toBe(
  true,
);
```

The exact helper name should match the exported helper already used in `apps/cli/test/unit/app/playback-session-controller.test.ts`.

- [ ] **Step 2: Run focused tests**

```bash
bun run test apps/cli/test/unit/app/playback-session-controller.test.ts apps/cli/test/integration/playback-policy.test.ts
```

Expected: fails until `recover` is handled.

- [ ] **Step 3: Consume `recover` in `PlaybackPhase`**

When `playerControl.consumeLastAction()` returns `recover`, choose the first safe action from the latest problem:

- `refresh`: refresh current provider source from trusted position.
- `pick-stream`: open combined streams picker.
- `relaunch`: relaunch mpv with current prepared stream from trusted position.
- `try-next-provider`: only when recovery is already provider-level or same-provider recovery failed.
- `diagnostics`: return to shell with diagnostics hint.

Keep `fallback` as an internal action for explicit recovery policy, not as the result of `/provider`.

- [ ] **Step 4: Replace provider failure hint**

In `PlaybackPhase`, replace `buildProviderFailureHint()` string output with `buildProviderResolveProblem()`. Render `problem.userMessage` in the current error UI until state grows a dedicated `playbackProblem` property.

- [ ] **Step 5: Run playback tests**

```bash
bun run test apps/cli/test/unit/app/playback-session-controller.test.ts apps/cli/test/integration/playback-policy.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app/PlaybackPhase.ts apps/cli/src/app/playback-session-controller.ts apps/cli/test/unit/app/playback-session-controller.test.ts apps/cli/test/integration/playback-policy.test.ts
git commit -m "Route playback recovery separately from provider fallback"
```

## Task 7: Playback Shell Footer And Command Routing

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Modify: `apps/cli/src/app-shell/command-router.ts`

- [ ] **Step 1: Update active playback hints**

Replace the long active playback hint with:

```ts
`${canSkip ? "b skip  ·  " : ""}k streams  ·  r recover  ·  / commands`;
```

If `canSkip` is not available in this component yet, start with:

```ts
"k streams  ·  r recover  ·  / commands";
```

and leave skip visibility to the mpv OSD state.

- [ ] **Step 2: Stop mapping provider to fallback**

In active playback `onCommandAction`, change:

```ts
if (action === "provider") {
  void container.playerControl.fallbackCurrentPlayback("playback-loading-command-fallback");
  return;
}
```

to route `provider` through the normal provider picker only outside active mpv playback. During active playback, show an OSD message or shell note:

```ts
if (action === "provider") {
  void container.playerControl.recoverCurrentPlayback("playback-loading-command-provider-recover");
  return;
}
```

Use `recoverCurrentPlayback` only if the current implementation cannot safely open the provider picker while mpv is active.

- [ ] **Step 3: Add streams action mapping**

Map `streams` to `pickSourceCurrentPlayback` for the first pass if the combined picker consumes selected stream IDs through the existing source/quality path. If Task 6 added direct stream picking, route to the direct stream picker.

- [ ] **Step 4: Remove fallback from footer**

Remove `f fallback` from `controlHint` and avoid exposing fallback as a top-level command in active playback.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx apps/cli/src/app-shell/command-router.ts
git commit -m "Simplify playback shell shortcuts"
```

## Task 8: Error Propagation And Diagnostics

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `apps/cli/src/domain/session/SessionState.ts`
- Modify: `apps/cli/test/unit/app-shell/panel-data.test.ts`
- Modify: `apps/cli/test/unit/domain/session/SessionState.test.ts`

- [ ] **Step 1: Add state test**

Add a test showing session state can store and clear a playback problem:

```ts
test("stores and clears playback problem", () => {
  const state = reducer(createInitialSessionState(), {
    type: "SET_PLAYBACK_PROBLEM",
    problem: {
      stage: "mpv",
      severity: "recoverable",
      cause: "expired-stream",
      userMessage: "The stream expired.",
      recommendedAction: "refresh",
      secondaryActions: ["diagnostics"],
    },
  });

  expect(state.playbackProblem?.cause).toBe("expired-stream");

  const cleared = reducer(state, { type: "CLEAR_PLAYBACK_PROBLEM" });
  expect(cleared.playbackProblem).toBeNull();
});
```

- [ ] **Step 2: Run state tests**

```bash
bun run test apps/cli/test/unit/domain/session/SessionState.test.ts
```

Expected: fails until state actions exist.

- [ ] **Step 3: Add state property and reducer actions**

Add `playbackProblem: PlaybackProblem | null` to session state. Add actions:

```ts
| { type: "SET_PLAYBACK_PROBLEM"; problem: PlaybackProblem }
| { type: "CLEAR_PLAYBACK_PROBLEM" }
```

Clear the problem when a new playback starts cleanly, a new search begins, or playback status returns to ready after a user action.

- [ ] **Step 4: Record diagnostics event**

Whenever `SET_PLAYBACK_PROBLEM` is dispatched from `PlaybackPhase`, also record a diagnostics event:

```ts
diagnosticsStore.record({
  category: "playback",
  message: problem.userMessage,
  context: {
    stage: problem.stage,
    severity: problem.severity,
    cause: problem.cause,
    recommendedAction: problem.recommendedAction,
    secondaryActions: problem.secondaryActions,
  },
});
```

- [ ] **Step 5: Surface problem in diagnostics panel**

Update `panel-data.ts` so `/diagnostics` includes latest playback problem with stage, cause, and recommended action.

- [ ] **Step 6: Run tests**

```bash
bun run test apps/cli/test/unit/domain/session/SessionState.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app/PlaybackPhase.ts apps/cli/src/app-shell/panel-data.ts apps/cli/src/domain/session/SessionState.ts apps/cli/test/unit/app-shell/panel-data.test.ts apps/cli/test/unit/domain/session/SessionState.test.ts
git commit -m "Surface structured playback problems"
```

## Task 9: Verification Pass

**Files:**

- Verify only unless failures require fixes.

- [ ] **Step 1: Format**

```bash
bun run fmt
```

Expected: completes without changing unrelated user files.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: pass.

- [ ] **Step 3: Lint**

```bash
bun run lint
```

Expected: pass with no warnings.

- [ ] **Step 4: Test**

```bash
bun run test
```

Expected: pass.

- [ ] **Step 5: Manual smoke**

Run one normal playback flow:

```bash
bun run dev -- -S "Breaking Bad"
```

Verify:

- Active footer does not show fallback provider as a normal shortcut.
- `/provider` means provider picker, not emergency fallback.
- `/recover` or `r` chooses recovery.
- `k streams` exposes source/quality/audio/subtitle facts.
- Provider failure shows a clear problem message and diagnostics entry.

- [ ] **Step 6: Final commit if verification changed files**

```bash
git add apps/cli/src apps/cli/test
git commit -m "Polish playback recovery verification fixes"
```

## Self-Review

- Spec coverage: playback footer simplification is covered by Task 7; provider/fallback separation is covered by Tasks 1, 2, 6, and 7; source/quality/audio/subtitle selection is covered by Task 5; error propagation and fail-fast guidance is covered by Tasks 3, 4, 6, and 8.
- Placeholder scan: no task uses placeholder language. Task 6 includes policy branches with concrete actions because exact helper names depend on the existing playback controller exports.
- Type consistency: `recover`, `streams`, `PlaybackProblem`, `PlaybackProblemAction`, and `recoverCurrentPlayback` are introduced before later tasks depend on them.
