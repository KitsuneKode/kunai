# Continuation Input Action Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Continue behavior, shell back/input ownership, and media actions composable enough for advanced features without badge/action drift or dropped-key regressions.

**Architecture:** First deepen the continuation decision Module so startup continue, history rows, result badges, and root history selection all cross one interface. Then deepen the shell input ownership Module so Esc/back and shortcut drops are decided in one place. Finally deepen media action execution so visible actions either execute through one Module or return an explicit unsupported result.

**Tech Stack:** Bun, TypeScript, Ink, custom render-capture test harness, `SessionStateManager`, `@kunai/storage`, `@kunai/providers`, `MediaActionRouter`.

## Global Constraints

- Use `bun run`, `bun run --cwd apps/cli`, and `bunx`; do not use `bun test` directly.
- Read `.docs/architecture.md`, `.docs/runtime-boundary-map.md`, `.docs/ux-architecture.md`, `.docs/testing-strategy.md`, and `.plans/plan-implementation-truth.md` before implementation.
- Preserve Netflix-style continuation anchoring: per title, use the most recent watched row; resume if unfinished; otherwise move forward to next/new/offline-ready; never scan back to older abandoned episodes.
- Release/calendar facts are freshness signals only; they do not imply playability unless local/provider evidence exists.
- Offline-ready continuation should be exposed as a switchable local source/provider-like option, not silently forced for ordinary online continue.
- Esc rule: first Esc clears local filter/day/query if present, otherwise closes the top overlay, otherwise returns to the previous shell state, otherwise no-ops at root.
- Visible but blocked shortcuts must surface a small status reason instead of silently dropping.
- Do not split `PlaybackPhase.ts` and `app-shell/workflows.ts` in the same commit.
- Do not change provider behavior without provider tests.
- Keep app-shell files as Ink intent adapters; provider/source extraction policy must not move into app-shell.
- Each task ends with a scoped commit. Run focused tests first, then the listed verification gate.

---

## File Structure

- Modify: `apps/cli/src/services/continuation/ContinueWatchingService.ts`
  - Owns repository-backed continuation decisions and adapters.
- Modify: `apps/cli/src/services/continuation/continuation-policy.ts`
  - Keeps projection/presentation compatibility while delegating to the decision owner.
- Modify: `apps/cli/src/app/launch-entry.ts`
  - Retains title/episode conversion helpers; stops owning startup decision selection.
- Modify: `apps/cli/src/main.ts`
  - Startup `--continue` calls the decision owner.
- Modify: `apps/cli/src/services/catalog/ResultEnrichmentService.ts`
  - Result badges use continuation projection from the decision owner.
- Modify: `apps/cli/src/app-shell/root-history-bridge.ts`
  - Root history selection uses the same decision output as badges.
- Modify: `apps/cli/src/app-shell/history-view.ts`
  - History row labels consume the shared continuation projection.
- Modify: `apps/cli/src/app-shell/input-router.ts`
  - Owns Esc/back ownership and blocked shortcut reasons.
- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
  - Uses input ownership decisions and forwards visible blocked reasons.
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
  - Stops hand-rolling Esc/back behavior where the input owner can decide.
- Modify: `apps/cli/src/services/media-actions/MediaActionRouter.ts`
  - Returns explicit handled/unsupported results.
- Modify: `apps/cli/src/services/media-actions/create-container-media-action-router.ts`
  - Provides one adapter for queue/follow/mute/mark/download/detail execution.
- Modify: `apps/cli/src/app-shell/history-workflows.ts`
  - Routes queue, mark watched, and local confirmation gates through the router.
- Modify: `apps/cli/src/app-shell/workflows.ts`
  - Routes remaining follow/mute/mark-watched shell actions through the router.
- Test: add/extend focused tests in `apps/cli/test/unit/services/continuation/`, `apps/cli/test/unit/services/catalog/`, `apps/cli/test/unit/app-shell/`, and `apps/cli/test/unit/services/media-actions/`.

---

### Task 1: Continue Decision Adapters

**Files:**

- Modify: `apps/cli/src/services/continuation/ContinueWatchingService.ts`
- Modify: `apps/cli/src/services/continuation/continuation-policy.ts`
- Modify: `apps/cli/src/app/launch-entry.ts`
- Test: `apps/cli/test/unit/services/continuation/continue-watching-service.test.ts`
- Test: `apps/cli/test/unit/services/continuation/continuation-policy.test.ts`
- Test: `apps/cli/test/unit/app/launch-entry.test.ts`

**Interfaces:**

- Consumes: `projectContinuation(input: ProjectContinuationInput): ContinuationDecision`
- Produces:

```ts
export type ContinuationTarget = {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: "movie" | "series";
  readonly season?: number;
  readonly episode?: number;
  readonly sourceEntry: HistoryProgress;
};

export type ContinuationPrimaryAction =
  | { readonly kind: "resume-online"; readonly target: ContinuationTarget }
  | { readonly kind: "select-online"; readonly target: ContinuationTarget }
  | { readonly kind: "play-local"; readonly target: ContinuationTarget; readonly jobId?: string }
  | { readonly kind: "manage-offline"; readonly target: ContinuationTarget };

export type ContinuationViewDecision = {
  readonly state: ContinuationStateKind;
  readonly target: ContinuationTarget | null;
  readonly badge?: string;
  readonly detail?: string;
  readonly primaryAction?: ContinuationPrimaryAction;
  readonly secondaryActions: readonly ContinuationPrimaryAction[];
  readonly freshness: "local" | "cached" | "stale";
};
```

- [ ] **Step 1: Write failing tests for startup-style decisions**

Add tests to `apps/cli/test/unit/services/continuation/continue-watching-service.test.ts`:

```ts
test("startupCandidate anchors on the most recent row and resumes unfinished progress", () => {
  const repo = createHistoryRepo([
    progress({
      titleId: "tmdb:1",
      title: "Demo",
      season: 1,
      episode: 2,
      completed: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    progress({
      titleId: "tmdb:1",
      title: "Demo",
      season: 1,
      episode: 3,
      completed: false,
      positionSeconds: 420,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  const service = new ContinueWatchingService(repo);

  const decision = service.startupCandidate({ scanLimit: 50 });

  expect(decision?.state).toBe("resume");
  expect(decision?.primaryAction).toMatchObject({
    kind: "resume-online",
    target: { titleId: "tmdb:1", season: 1, episode: 3 },
  });
});

test("startupCandidate exposes offline-ready as local primary with online secondary", () => {
  const repo = createHistoryRepo([
    progress({
      titleId: "tmdb:1",
      title: "Demo",
      season: 1,
      episode: 3,
      completed: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  const service = new ContinueWatchingService(repo);

  const decision = service.startupCandidate({
    signalsByTitle: () => ({
      offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 4, jobId: "job-4" }] },
    }),
  });

  expect(decision?.state).toBe("offline-ready");
  expect(decision?.primaryAction).toMatchObject({ kind: "play-local", jobId: "job-4" });
  expect(decision?.secondaryActions).toContainEqual(
    expect.objectContaining({
      kind: "select-online",
      target: expect.objectContaining({ episode: 4 }),
    }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts
```

Expected: FAIL because `startupCandidate` and `ContinuationViewDecision` do not exist.

- [ ] **Step 3: Implement the adapter methods**

Add the exported types above to `ContinueWatchingService.ts`, plus:

```ts
export type StartupContinuationOptions = {
  readonly scanLimit?: number;
  readonly limit?: number;
  readonly signalsByTitle?: (titleId: string) => ContinuationSignals;
};

export class ContinueWatchingService {
  // existing constructor and methods stay

  startupCandidate(options: StartupContinuationOptions = {}): ContinuationViewDecision | null {
    return (
      this.recentDecisions({
        limit: options.limit ?? 1,
        scanLimit: options.scanLimit ?? 500,
        signalsByTitle: options.signalsByTitle,
      })[0] ?? null
    );
  }

  recentDecisions(options: StartupContinuationOptions = {}): ContinuationViewDecision[] {
    const anchors = groupLatestByTitle(
      this.historyRepository.listRecent(options.scanLimit ?? 500),
    ).slice(0, options.limit ?? 25);
    return anchors.map((anchor) =>
      this.toViewDecision(
        projectContinuation({
          titleId: anchor.titleId,
          rows: [anchor],
          ...options.signalsByTitle?.(anchor.titleId),
        }),
      ),
    );
  }

  titleDecision(titleId: string, signals: ContinuationSignals = {}): ContinuationViewDecision {
    return this.toViewDecision(this.projectTitle(titleId, signals));
  }

  private toViewDecision(decision: ContinuationDecision): ContinuationViewDecision {
    const anchor = decision.anchor;
    if (!anchor) {
      return { state: decision.state, target: null, secondaryActions: [], freshness: "cached" };
    }
    const mediaKind = anchor.mediaKind ?? (anchor.season || anchor.episode ? "series" : "movie");
    const target: ContinuationTarget = {
      titleId: decision.titleId,
      title: decision.title ?? anchor.title,
      mediaKind,
      season: decision.season ?? anchor.season,
      episode: decision.episode ?? anchor.episode ?? anchor.absoluteEpisode,
      sourceEntry: anchor,
    };
    const onlineAction: ContinuationPrimaryAction =
      decision.state === "resume"
        ? { kind: "resume-online", target }
        : { kind: "select-online", target };
    if (decision.state === "offline-ready") {
      return {
        state: decision.state,
        target,
        badge: "downloaded",
        detail: "downloaded copy ready",
        primaryAction: { kind: "play-local", target, jobId: decision.jobId },
        secondaryActions: [onlineAction],
        freshness: "local",
      };
    }
    if (decision.state === "resume" || decision.state === "next-up") {
      return {
        state: decision.state,
        target,
        badge: decision.state === "resume" ? "continue" : "next",
        detail: decision.state === "resume" ? "resume where you left off" : "next episode ready",
        primaryAction: onlineAction,
        secondaryActions: [],
        freshness: "cached",
      };
    }
    return {
      state: decision.state,
      target,
      badge: decision.state === "new-episodes" ? `${decision.newEpisodeCount ?? 1} new` : undefined,
      detail:
        decision.state === "airing-weekly" ? "next release is not provider-confirmed" : undefined,
      primaryAction: undefined,
      secondaryActions: [],
      freshness: "cached",
    };
  }
}
```

- [ ] **Step 4: Keep projection compatibility**

Update `continuation-policy.ts` so `projectContinuationState(...)` still returns the existing `ContinuationProjection` shape, but add a helper:

```ts
export function projectionFromViewDecision(
  decision: ContinuationViewDecision,
): ContinuationProjection {
  if (!decision.target) return { kind: "empty", titleId: "unknown" };
  const { target } = decision;
  if (decision.primaryAction?.kind === "play-local") {
    return {
      kind: "offline-ready",
      titleId: target.titleId,
      title: target.title,
      season: target.season ?? 1,
      episode: target.episode ?? 1,
      sourceEntry: target.sourceEntry,
      badge: decision.badge,
      primaryAction: {
        kind: "play-local",
        season: target.season ?? 1,
        episode: target.episode ?? 1,
        jobId: decision.primaryAction.jobId,
      },
      secondaryActions: [
        { kind: "select-online", season: target.season ?? 1, episode: target.episode ?? 1 },
      ],
      freshness: decision.freshness,
    };
  }
  // Keep existing cases for resume/next/new/upcoming/up-to-date by mapping from decision.state.
  return projectContinuationState({
    titleId: target.titleId,
    entries: [[target.titleId, target.sourceEntry]],
  });
}
```

- [ ] **Step 5: Run focused tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts test/unit/services/continuation/continuation-policy.test.ts test/unit/app/launch-entry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/services/continuation/ContinueWatchingService.ts apps/cli/src/services/continuation/continuation-policy.ts apps/cli/test/unit/services/continuation/continue-watching-service.test.ts apps/cli/test/unit/services/continuation/continuation-policy.test.ts apps/cli/test/unit/app/launch-entry.test.ts
git commit -m "refactor(continuation): add shared continue decisions"
```

---

### Task 2: Startup, History, and Result Badges Use Continue Decision

**Files:**

- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/app/launch-entry.ts`
- Modify: `apps/cli/src/services/catalog/ResultEnrichmentService.ts`
- Modify: `apps/cli/src/app-shell/root-history-bridge.ts`
- Modify: `apps/cli/src/app-shell/history-view.ts`
- Test: `apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts`
- Test: `apps/cli/test/unit/app-shell/root-history-bridge.test.ts`
- Test: `apps/cli/test/unit/app-shell/history-view.test.ts`

**Interfaces:**

- Consumes: `ContinueWatchingService.startupCandidate(...)`
- Consumes: `ContinueWatchingService.titleDecision(titleId, signals)`
- Produces: no new public interface; old callers keep their current output shapes.

- [ ] **Step 1: Write failing tests for badge/action alignment**

Add to `root-history-bridge.test.ts`:

```ts
test("buildRootHistorySelection uses the same offline-ready action as the continuation decision", () => {
  const entry = history({
    titleId: "tmdb:1",
    title: "Demo",
    season: 1,
    episode: 3,
    completed: true,
  });
  const selection = buildRootHistorySelection(
    { titleId: "tmdb:1", entry },
    undefined,
    new Map([
      [
        "tmdb:1",
        {
          kind: "offline-ready",
          titleId: "tmdb:1",
          title: "Demo",
          season: 1,
          episode: 4,
          sourceEntry: entry,
          primaryAction: { kind: "play-local", season: 1, episode: 4, jobId: "job-4" },
          secondaryActions: [{ kind: "select-online", season: 1, episode: 4 }],
          freshness: "local",
          badge: "downloaded",
        },
      ],
    ]),
  );

  expect(selection.localJobId).toBe("job-4");
  expect(selection.targetEpisode).toEqual({ season: 1, episode: 4, reason: "offline-ready" });
});
```

Add to `result-enrichment-service.test.ts`:

```ts
test("enrichment badge comes from the continuation decision for unfinished progress", async () => {
  const service = new ResultEnrichmentService({
    historyStore: {
      getAll: async () => ({
        "tmdb:1": history({
          titleId: "tmdb:1",
          title: "Demo",
          completed: false,
          positionSeconds: 300,
        }),
      }),
    },
    offlineLibraryService: { peekRecordedArtifactStatuses: async () => [] },
  });

  const enriched = await service.enrichResults([
    { id: "tmdb:1", type: "series", title: "Demo" } as never,
  ]);

  expect(enriched.get("tmdb:1")?.badges.some((badge) => badge.label.startsWith("continue"))).toBe(
    true,
  );
});
```

- [ ] **Step 2: Run tests to verify current drift**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/root-history-bridge.test.ts test/unit/services/catalog/result-enrichment-service.test.ts
```

Expected: FAIL if the new helper shapes from Task 1 are not wired.

- [ ] **Step 3: Wire startup continue**

In `main.ts`, replace the local unfinished recency selection with:

```ts
const decision = container.continueWatchingService.startupCandidate({
  scanLimit: 500,
});
if (!decision?.target || !decision.primaryAction) {
  container.diagnosticsService.record({
    category: "session",
    message: "Continue requested but no playable continuation decision was available",
  });
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: "No unfinished or ready continuation target yet.",
  });
  return null;
}
const selection = historyLaunchSelectionFromContinuation(decision);
```

In `launch-entry.ts`, add:

```ts
export function historyLaunchSelectionFromContinuation(
  decision: ContinuationViewDecision,
): HistoryLaunchSelection {
  if (!decision.target) throw new Error("Cannot launch an empty continuation decision");
  return {
    titleId: decision.target.titleId,
    entry: decision.target.sourceEntry,
    targetEpisode:
      decision.target.mediaKind === "series"
        ? {
            season: decision.target.season ?? 1,
            episode: decision.target.episode ?? 1,
            reason: decision.primaryAction?.kind === "play-local" ? "offline-ready" : "resume",
          }
        : undefined,
  };
}
```

- [ ] **Step 4: Wire result enrichment and root history**

In `ResultEnrichmentService`, add optional dependency:

```ts
readonly continueWatchingService?: Pick<ContinueWatchingService, "titleDecision">;
```

When `historyEntry` exists, build the badge from the service when present:

```ts
const decision = this.deps.continueWatchingService?.titleDecision(result.id, {
  nextRelease,
  offline: offlineStatusesToSignals(offlineByTitleId.get(result.id) ?? []),
});
const enrichment = decision
  ? buildResultEnrichmentFromContinuation({
      result,
      decision,
      offlineStatuses: offlineByTitleId.get(result.id) ?? [],
    })
  : buildResultEnrichment({
      result,
      historyEntry,
      nextRelease,
      offlineStatuses: offlineByTitleId.get(result.id) ?? [],
    });
```

Keep the existing fallback path so this task can land without a big-bang container rewrite.

- [ ] **Step 5: Run focused tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts test/unit/services/catalog/result-enrichment-service.test.ts test/unit/app-shell/root-history-bridge.test.ts test/unit/app/launch-entry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/main.ts apps/cli/src/app/launch-entry.ts apps/cli/src/services/catalog/ResultEnrichmentService.ts apps/cli/src/app-shell/root-history-bridge.ts apps/cli/src/app-shell/history-view.ts apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts apps/cli/test/unit/app-shell/root-history-bridge.test.ts apps/cli/test/unit/app-shell/history-view.test.ts
git commit -m "refactor(app): route continue surfaces through decision owner"
```

---

### Task 3: Shell Input Ownership and Back Stack

**Files:**

- Modify: `apps/cli/src/app-shell/input-router.ts`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/shell-command-input.ts`
- Test: `apps/cli/test/unit/app-shell/input-router.test.ts`
- Test: `apps/cli/test/unit/app-shell/input-router.useinput.test.tsx`
- Test: `apps/cli/test/unit/app-shell/shell-command-input.useinput.test.tsx`

**Interfaces:**

- Consumes: existing `routeShellInput(input, key, context)`
- Produces:

```ts
export type ShellBackTarget = "clear-local" | "close-overlay" | "back" | "root-noop";

export type ShellInputBlockedReason =
  | "command-palette-open"
  | "modal-owns-input"
  | "overlay-owns-input"
  | "text-input-owns-input"
  | "shortcut-disabled";

export type ShellInputRoute = {
  readonly owner: ShellInputOwner;
  readonly command: ShellInputCommand | null;
  readonly backTarget?: ShellBackTarget;
  readonly blockedReason?: ShellInputBlockedReason;
};
```

- [ ] **Step 1: Write failing tests for Esc/back ownership**

Add to `input-router.test.ts`:

```ts
test("Esc clears local state before closing overlay or backing out", () => {
  expect(routeShellInput("", { escape: true }, { localClearAvailable: true })).toMatchObject({
    owner: "surface",
    command: "back",
    backTarget: "clear-local",
  });
  expect(routeShellInput("", { escape: true }, { overlayOpen: true })).toMatchObject({
    owner: "overlay",
    command: "back",
    backTarget: "close-overlay",
  });
  expect(routeShellInput("", { escape: true }, { canGoBack: true })).toMatchObject({
    owner: "surface",
    command: "back",
    backTarget: "back",
  });
  expect(routeShellInput("", { escape: true }, {})).toMatchObject({
    owner: "surface",
    command: "back",
    backTarget: "root-noop",
  });
});

test("visible disabled shortcuts return blocked reasons", () => {
  expect(routeShellInput("n", {}, { disabledShortcut: true })).toMatchObject({
    blockedReason: "shortcut-disabled",
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/input-router.test.ts
```

Expected: FAIL because `localClearAvailable`, `canGoBack`, `disabledShortcut`, `command: "back"`, and `backTarget` are not implemented.

- [ ] **Step 3: Implement back target routing**

Update `ShellInputRouteContext` and `ShellInputCommand`:

```ts
export type ShellInputRouteContext = {
  readonly commandPaletteOpen?: boolean;
  readonly modalOpen?: boolean;
  readonly overlayOpen?: boolean;
  readonly textInputFocused?: boolean;
  readonly localClearAvailable?: boolean;
  readonly canGoBack?: boolean;
  readonly disabledShortcut?: boolean;
};

export type ShellInputCommand = "quit" | "open-command-palette" | "back" | OverlayInputCommand;
```

Add:

```ts
function routeBack(context: ShellInputRouteContext): ShellInputRoute {
  if (context.localClearAvailable)
    return { owner: "surface", command: "back", backTarget: "clear-local" };
  if (context.overlayOpen)
    return { owner: "overlay", command: "back", backTarget: "close-overlay" };
  if (context.canGoBack) return { owner: "surface", command: "back", backTarget: "back" };
  return { owner: "surface", command: "back", backTarget: "root-noop" };
}
```

Call `routeBack(context)` before text input editing when `key.escape` is true, except hard-global quit.

- [ ] **Step 4: Surface blocked shortcut feedback**

In `ShellFrame`, add prop:

```ts
onBlockedInput?: (reason: ShellInputBlockedReason) => void;
```

When a route has `blockedReason`, call `onBlockedInput(route.blockedReason)` and return. In root surfaces, map this to:

```ts
container.stateManager.dispatch({
  type: "SET_PLAYBACK_FEEDBACK",
  note: "Shortcut unavailable here. Press / to see available actions.",
});
```

- [ ] **Step 5: Run focused tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/input-router.test.ts test/unit/app-shell/input-router.useinput.test.tsx test/unit/app-shell/shell-command-input.useinput.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/app-shell/input-router.ts apps/cli/src/app-shell/shell-frame.tsx apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/src/app-shell/shell-command-input.ts apps/cli/test/unit/app-shell/input-router.test.ts apps/cli/test/unit/app-shell/input-router.useinput.test.tsx apps/cli/test/unit/app-shell/shell-command-input.useinput.test.tsx
git commit -m "fix(app-shell): centralize esc and blocked shortcut routing"
```

---

### Task 4: Media Action Execution Results

**Files:**

- Modify: `apps/cli/src/services/media-actions/MediaActionRouter.ts`
- Modify: `apps/cli/src/services/media-actions/create-container-media-action-router.ts`
- Modify: `apps/cli/src/app-shell/history-workflows.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/use-history-overlay-input.ts`
- Test: `apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts`
- Test: `apps/cli/test/unit/services/media-actions/create-container-media-action-router.test.ts`
- Test: `apps/cli/test/unit/app-shell/use-history-overlay-input.test.ts`

**Interfaces:**

- Produces:

```ts
export type MediaActionRunResult =
  | { readonly status: "handled"; readonly actionId: MediaActionId }
  | { readonly status: "unsupported"; readonly actionId: MediaActionId; readonly reason: string };
```

- [ ] **Step 1: Write failing tests for unsupported action results**

Add to `MediaActionRouter.test.ts`:

```ts
test("returns unsupported when a displayed action has no executor", async () => {
  const router = new MediaActionRouter({});

  await expect(router.run({ actionId: "follow", item, source: "history" })).resolves.toEqual({
    status: "unsupported",
    actionId: "follow",
    reason: "No executor registered for follow",
  });
});

test("returns handled when follow executor runs", async () => {
  const router = new MediaActionRouter({
    attention: { follow: async () => {} },
  });

  await expect(router.run({ actionId: "follow", item, source: "history" })).resolves.toEqual({
    status: "handled",
    actionId: "follow",
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/media-actions/MediaActionRouter.test.ts
```

Expected: FAIL because `run` currently throws or returns void for missing executors.

- [ ] **Step 3: Implement result-returning router**

Change `MediaActionRouter.run(...)` to return `Promise<MediaActionRunResult>`.

Replace `requireAction(...)` throwing behavior with:

```ts
function unsupported(actionId: MediaActionId): MediaActionRunResult {
  return { status: "unsupported", actionId, reason: `No executor registered for ${actionId}` };
}
```

For each handled case:

```ts
await executor(input.item);
return { status: "handled", actionId: input.actionId };
```

- [ ] **Step 4: Route history and workflows through the router**

In `history-workflows.ts`, keep confirmation/picker gates local, but execute with:

```ts
const result = await mediaActions.run({ actionId: "mark-watched", item, source: "history" });
if (result.status === "unsupported") {
  actionContext?.setStatus?.(result.reason);
}
```

In `workflows.ts`, replace direct `followedTitleRepository.upsert(...)` for shell follow/mute paths with `createContainerMediaActionRouter(container).run(...)`.

- [ ] **Step 5: Run focused tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/media-actions/MediaActionRouter.test.ts test/unit/services/media-actions/create-container-media-action-router.test.ts test/unit/app-shell/use-history-overlay-input.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/services/media-actions/MediaActionRouter.ts apps/cli/src/services/media-actions/create-container-media-action-router.ts apps/cli/src/app-shell/history-workflows.ts apps/cli/src/app-shell/workflows.ts apps/cli/src/app-shell/use-history-overlay-input.ts apps/cli/test/unit/services/media-actions/MediaActionRouter.test.ts apps/cli/test/unit/services/media-actions/create-container-media-action-router.test.ts apps/cli/test/unit/app-shell/use-history-overlay-input.test.ts
git commit -m "refactor(media-actions): return explicit execution results"
```

---

### Task 5: Plan Truth, Regression Gates, and Next Feature Lane

**Files:**

- Modify: `.plans/codebase-architecture-sweep.md`
- Modify: `.plans/plan-implementation-truth.md`
- Modify: `.plans/architecture-improvement-2026-06-22/README.md`
- Create: `.plans/continue-calendar-diagnostics-feature-spine.md`

**Interfaces:**

- Consumes: completed Tasks 1-4.
- Produces: updated planning truth and the next product lane: Continue Hub, Calendar Command Center, Diagnostics Lab.

- [ ] **Step 1: Update architecture sweep statuses**

In `.plans/codebase-architecture-sweep.md`, update:

```md
8. `refactor(app): unify history and continuation entrypoints`
   - Status: Done
   - Startup `--continue`, history row Enter targets, result enrichment, and root history selection now use the continuation decision owner.

9. `refactor(app): unify queue and media actions`
   - Status: Done for history/post-play/follow foundations
   - Remaining: notification-specific UX polish and richer unsupported-action copy.
```

- [ ] **Step 2: Update plan truth known gaps**

In `.plans/plan-implementation-truth.md`, replace the matching known gaps with:

```md
- **Continuation decision owner** — implemented for startup, history, result badges, and root selection. Continue Hub product polish remains.
- **Central input routing** — Esc/back and blocked shortcut ownership are centralized; remaining work is reducing local `useInput` call sites surface by surface.
- **Media action executor** — core queue/follow/mark/download/detail actions return handled/unsupported results; notification copy can be polished later.
```

- [ ] **Step 3: Create next feature lane doc**

Create `.plans/continue-calendar-diagnostics-feature-spine.md`:

```md
# Continue, Calendar, Diagnostics Feature Spine

## Order

1. Continue Hub
2. Calendar Command Center
3. Diagnostics Lab
4. Provider/Source Control Center
5. Offline Runway polish

## Continue Hub

Use the continuation decision owner for rows, badges, startup, root history, and offline-ready options. Local downloaded media appears as a switchable local source/provider-like action, not as an invisible override.

## Calendar Command Center

Calendar rows show release facts and safe actions. Aired/released does not mean playable unless a provider-confirmed or local-ready signal exists.

## Diagnostics Lab

Expose input ownership drops, provider work lanes, continuation decisions, media action unsupported results, and playback recovery decisions in the diagnostics overlay/support bundle.
```

- [ ] **Step 4: Run full verification**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
```

Expected: all pass. If a known release bundle assertion fails on a clean tree, update the stale assertion in the same scoped commit only if it is caused by these docs; otherwise report it separately.

- [ ] **Step 5: Commit**

```sh
git add .plans/codebase-architecture-sweep.md .plans/plan-implementation-truth.md .plans/architecture-improvement-2026-06-22/README.md .plans/continue-calendar-diagnostics-feature-spine.md
git commit -m "docs(plans): record continuation input action spine"
```

---

## Execution Notes

- Prefer one worker lane at a time until Task 2 is complete, because continuation touches shared startup/history/enrichment code.
- Task 3 can run in parallel only after Task 2 lands, because both may touch root overlay/history surfaces.
- Task 4 can run in parallel with Task 3 if workers coordinate write ownership: Task 3 owns input files; Task 4 owns media-action files and history/workflow execution paths.
- Do not implement Calendar Command Center in this plan. This plan creates the safe decision and input spine it needs.
- Do not implement Diagnostics Lab fully in this plan. Only ensure blocked shortcut/media unsupported results are representable so diagnostics can consume them later.

## Self-Review

- Spec coverage: user decisions 1-6 are covered by Tasks 1-5.
- Placeholder scan: no forbidden placeholder wording or unspecified test-only steps remain.
- Type consistency: `ContinuationViewDecision`, `ContinuationPrimaryAction`, `ShellInputRoute`, and `MediaActionRunResult` are defined before downstream tasks consume them.
