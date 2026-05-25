# Kunai Active Runtime Observability Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active-runtime diagnostics consistent, redacted, correlated, and detailed enough to identify provider/playback latency and failure causes in the panel, JSONL traces, and exported support bundles.

**Architecture:** Keep the existing `DiagnosticsService` and bounded store, but make `DiagnosticsService.record()` the writable active-runtime boundary while the store remains a read/snapshot primitive. Add real provider-attempt observations at the core provider engine boundary, thread correlation through mpv/subtitle paths, retain bounded resolve-work evidence for exports, and project those facts into a truthful diagnostics overlay.

**Tech Stack:** Bun, TypeScript, Ink CLI shell, `@kunai/core` provider engine, existing diagnostics/support-bundle services, Bun unit/integration tests.

**Design Reference:** `docs/superpowers/specs/2026-05-26-kunai-runtime-observability-repair-design.md`

---

## File Structure

### Diagnostic Ingestion And Privacy

- Modify: `apps/cli/src/services/diagnostics/DiagnosticsService.ts`
  - Public recorder and support-bundle input contract.
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`
  - Canonical fan-out to bounded storage, logger, JSONL traces and completed resolve-work evidence.
- Modify: `apps/cli/src/services/diagnostics/redaction.ts`
  - Shared secret/path redaction coverage.
- Modify: `apps/cli/src/infra/logger/StructuredLogger.ts`
  - Bound logger context and injected redaction before stderr serialization.
- Modify: `apps/cli/src/container.ts`
  - Wire recorder dependencies and logger sanitizer through active services.
- Test: `apps/cli/test/unit/services/diagnostics/redaction.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/diagnostics-service.test.ts`
- Create/Test: `apps/cli/test/unit/infra/logger/structured-logger.test.ts`

### Provider, Player And Subtitle Timing

- Modify: `packages/core/src/provider-engine.ts`
  - Real physical attempt observer and timing events.
- Modify: `packages/core/test/core.test.ts`
  - Attempt/retry/fallback observer contract tests.
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
  - Map engine observations to correlated app resolve events.
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
  - Record live provider evidence through diagnostics.
- Modify: `apps/cli/src/services/playback/ResolveWorkLedger.ts`
  - Record physical provider timing facts when needed for request-economy insights.
- Test: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-work-service.test.ts`
- Modify: `apps/cli/src/infra/player/PlayerServiceImpl.ts`
  - Safe player logs and correlated autoplay events.
- Modify: `apps/cli/src/infra/player/persistent-subtitle-manager.ts`
  - Classified subtitle attachment result.
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
  - Late subtitle/provenance outcomes and timing projection.
- Create/Test: `apps/cli/test/unit/infra/player/PlayerServiceImpl.test.ts`
- Test: `apps/cli/test/unit/infra/player/persistent-subtitle-manager.test.ts`
- Test: `apps/cli/test/unit/app/playback-phase-events.test.ts`

### Export And Presentation

- Modify: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
  - Completed bounded ledger callback/storage handoff.
- Modify: `apps/cli/src/services/diagnostics/support-bundle.ts`
  - Provider-attempt/startup/ledger insights.
- Modify: `apps/cli/src/app-shell/workflows.ts`
  - Export the diagnostic service-owned evidence.
- Modify: `apps/cli/src/app-shell/panel-data.ts`
  - Active correlation, slowest stage, provider timing, subtitle/provenance and unknown state projection.
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/runtime-bindings.ts`
  - Supply evidence consistently to the panel.
- Test: `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`

### Remaining Active Emitters And Documentation

- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/app/SearchPhase.ts`
- Modify: `apps/cli/src/app/DownloadOnlyPhase.ts`
- Modify: `apps/cli/src/app/SessionController.ts`
- Modify: `apps/cli/src/app/launch-entry.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/runtime-bindings.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`
- Modify: `apps/cli/src/infra/work/WorkControlServiceImpl.ts`
- Modify: `apps/cli/src/services/attention/AttentionRefreshWorker.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/services/persistence/StorageMaintenanceService.ts`
- Modify: `apps/cli/src/services/playback/SourceInventoryService.ts`
- Modify: `apps/cli/src/services/presence/PresenceServiceImpl.ts`
- Modify: `apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts`
- Modify: `.docs/diagnostics-guide.md`
- Modify: `.docs/debugging-map.md`
- Test: existing tests adjacent to every migrated service.

## Task 1: Canonical Diagnostic Recorder And Redacted Logger

**Purpose:** Establish the single safe event path before changing richer provider or UI evidence.

**Files:**

- Modify: `apps/cli/src/services/diagnostics/DiagnosticsService.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`
- Modify: `apps/cli/src/services/diagnostics/redaction.ts`
- Modify: `apps/cli/src/infra/logger/StructuredLogger.ts`
- Modify: `apps/cli/src/container.ts`
- Test: `apps/cli/test/unit/services/diagnostics/redaction.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/diagnostics-service.test.ts`
- Create: `apps/cli/test/unit/infra/logger/structured-logger.test.ts`

- [ ] **Step 1: Write failing redaction tests for realistic diagnostic leakage**

Add cases proving signed-CDN query fields and home paths embedded inside error text are stripped:

```ts
test("redacts signed CDN query parameters case-insensitively", () => {
  expect(
    redactDiagnosticValue({
      url: "https://cdn.example/video.m3u8?X-Amz-Credential=user%2Fscope&X-Amz-Signature=secret&Policy=encoded",
    }),
  ).toEqual({
    url: "https://cdn.example/video.m3u8?X-Amz-Credential=[redacted]&X-Amz-Signature=[redacted]&Policy=[redacted]",
  });
});

test("redacts a home path embedded in an error sentence", () => {
  expect(
    redactDiagnosticValue(`ENOENT opening ${process.env.HOME}/.config/kunai/private.json`, {
      homeDir: process.env.HOME,
    }),
  ).toBe("ENOENT opening ~/.config/kunai/private.json");
});
```

- [ ] **Step 2: Write failing logger tests for bound context and redacted stderr**

Create a captured-stderr test around `StructuredLogger`:

```ts
test("child logger retains context and redacts diagnostic locations", () => {
  const write = mock(() => true);
  const logger = new StructuredLogger({
    debug: true,
    write,
    sanitize: (value) => redactDiagnosticValue(value),
  }).child({ playbackCycleId: "cycle-1" });

  logger.info("Launching MPV", {
    url: "https://cdn.example/stream.m3u8?token=secret",
  });

  const output = String(write.mock.calls[0]?.[0]);
  expect(output).toContain("cycle-1");
  expect(output).toContain("token=[redacted]");
  expect(output).not.toContain("token=secret");
});
```

- [ ] **Step 3: Write a failing canonical fan-out test**

Extend `diagnostics-service.test.ts` using a temporary `DebugTraceReporter` file:

```ts
service.record({
  category: "playback",
  operation: "playback.startup.timeline",
  sessionId: "session-1",
  playbackCycleId: "cycle-1",
  message: "Playback startup progress",
  context: { streamUrl: "https://cdn.example/live.m3u8?X-Amz-Signature=secret" },
});

expect(store.getSnapshot()[0]?.operation).toBe("playback.startup.timeline");
expect(logger.entries[0]?.context).toMatchObject({
  streamUrl: "https://cdn.example/live.m3u8?X-Amz-Signature=[redacted]",
});
expect(await Bun.file(tracePath).text()).toContain("X-Amz-Signature=[redacted]");
```

- [ ] **Step 4: Run focused tests to prove the failures**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: FAIL because signed parameters/embedded paths, bound logger context, injected output writer/sanitizer, or canonical redacted fan-out are not implemented.

- [ ] **Step 5: Implement the privacy and recorder contracts**

In `redaction.ts`, use normalized matching instead of enumerating only short legacy keys:

```ts
function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll("_", "-");
  return (
    SENSITIVE_QUERY_KEYS.has(normalized) ||
    normalized.endsWith("-signature") ||
    normalized.endsWith("-credential") ||
    normalized.endsWith("-security-token") ||
    normalized === "policy"
  );
}

function redactPath(value: string, options: RedactionOptions): string {
  if (!options.homeDir) return value;
  return value.replaceAll(options.homeDir, "~");
}
```

Keep `DiagnosticsStoreImpl` defensive redaction in place, but ensure the service sends sanitized diagnostic context to output sinks:

```ts
record(event: DiagnosticEventInput): void {
  this.deps.store.record(event);
  const safeEvent = redactDiagnosticValue(event, {
    homeDir: process.env.HOME,
  }) as DiagnosticEventInput;
  this.log(safeEvent);
  this.deps.traceReporter?.record(safeEvent);
}
```

Make logger output injectable and child context persistent:

```ts
export interface StructuredLoggerOptions {
  console?: boolean;
  debug?: boolean;
  write?: (line: string) => unknown;
  sanitize?: (value: unknown) => unknown;
}

constructor(
  private options: StructuredLoggerOptions = {},
  private readonly boundContext: Record<string, unknown> = {},
) {}

child(context: Record<string, unknown>): Logger {
  return new StructuredLogger(this.options, { ...this.boundContext, ...context });
}

private log(level: LogEntry["level"], message: string, context?: Record<string, unknown>): void {
  if (!this.isDebugMode) return;
  const merged = { ...this.boundContext, ...context };
  const safeMessage = String(this.options.sanitize?.(message) ?? message);
  const safeContext = this.options.sanitize?.(merged) ?? merged;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()}: ${safeMessage} ${JSON.stringify(safeContext)}\n`;
  (this.options.write ?? ((value) => process.stderr.write(value)))(line);
}
```

Wire the sanitizing logger option in `container.ts`.

- [ ] **Step 6: Run focused tests to prove the foundation passes**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: PASS.

- [ ] **Step 7: Commit the foundation**

```sh
git add apps/cli/src/services/diagnostics/DiagnosticsService.ts apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts apps/cli/src/services/diagnostics/redaction.ts apps/cli/src/infra/logger/StructuredLogger.ts apps/cli/src/container.ts apps/cli/test/unit/services/diagnostics/redaction.test.ts apps/cli/test/unit/services/diagnostics/diagnostics-service.test.ts apps/cli/test/unit/infra/logger/structured-logger.test.ts
git commit -m "fix(diagnostics): establish redacted event ingestion"
```

## Task 2: Migrate Playback And Player Evidence To The Recorder

**Purpose:** Ensure the exact evidence required for current playback latency debugging reaches `/diagnostics`, JSONL and exports through the same path.

**Files:**

- Modify: `apps/cli/src/infra/player/PlayerServiceImpl.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/container.ts`
- Create: `apps/cli/test/unit/infra/player/PlayerServiceImpl.test.ts`
- Test: `apps/cli/test/unit/app/playback-phase-events.test.ts`

- [ ] **Step 1: Write failing player tests for safe output and autoplay correlation**

Add tests with a diagnostic recorder spy:

```ts
test("autoplay runtime events retain playback correlation", async () => {
  const diagnostics = createRecorder();
  const service = createPlayerService({ diagnostics });
  await service.play(stream, {
    playbackMode: "autoplay-chain",
    displayTitle: "The Boys S01E02",
    correlation: {
      sessionId: "session-1",
      playbackCycleId: "cycle-2",
      providerAttemptId: "provider-2",
    },
  });

  expect(diagnostics.events.find((event) => event.message === "MPV runtime event")).toMatchObject({
    playbackCycleId: "cycle-2",
    providerAttemptId: "provider-2",
  });
});

test("player output never prints attached subtitle URL", async () => {
  await service.play({ ...stream, subtitle: "https://subs.example/a.vtt?token=secret" }, options);
  expect(stderr).toContain("Subtitle attached");
  expect(stderr).not.toContain("https://subs.example");
});
```

- [ ] **Step 2: Write failing startup JSONL integration test**

In `playback-phase-events.test.ts`, provide a `DiagnosticsServiceImpl` with a `DebugTraceReporter`, trigger a startup mark and mpv event through the playback-phase/player seam, and assert:

```ts
expect(traceEvents.map((event) => event.operation)).toContain("playback.startup.timeline");
expect(traceEvents.some((event) => event.context?.event === "first-progress")).toBe(true);
expect(traceEvents.every((event) => event.playbackCycleId === "cycle-1")).toBe(true);
```

- [ ] **Step 3: Run the failing playback evidence tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: FAIL because playback/player code writes to `DiagnosticsStore`, raw subtitle locations are displayed, and autoplay wrapping omits correlation.

- [ ] **Step 4: Replace writable playback store dependencies with a diagnostic recorder**

Use the existing interface rather than creating a parallel event system:

```ts
type DiagnosticRecorder = Pick<DiagnosticsService, "record">;

constructor(
  private deps: {
    logger: Logger;
    tracer: Tracer;
    diagnostics: DiagnosticRecorder;
    playerControl: PlayerControlService;
    config: ConfigService;
    mpv?: MpvRuntimeOptions;
  },
) {}
```

Update playback/player writes from `diagnosticsStore.record(...)` to `diagnostics.record(...)`. Keep store reads in shell/export code until Task 6.

Remove location disclosure from normal output and context:

```ts
process.stderr.write(
  playbackStream.subtitle
    ? "Subtitle attached; playback will include the selected track.\n"
    : `${options.subtitleStatus ?? "Subtitles not attached"}; playback will start without a subtitle file.\n`,
);

this.deps.diagnostics.record({
  ...options.correlation,
  category: "playback",
  operation: "playback.player.launch",
  message: "Launching MPV",
  context: {
    title: options.displayTitle,
    hasSubtitle: Boolean(playbackStream.subtitle),
    subtitleStatus: options.subtitleStatus ?? null,
    deferredMedia: Boolean(stream.deferredLocator),
  },
});
```

Fix the autoplay omission:

```ts
onPlaybackEvent: this.wrapPlaybackEventHandler(options.onPlaybackEvent, options.correlation),
```

- [ ] **Step 5: Run playback evidence tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: PASS.

- [ ] **Step 6: Commit the playback ingestion migration**

```sh
git add apps/cli/src/infra/player/PlayerServiceImpl.ts apps/cli/src/app/PlaybackPhase.ts apps/cli/src/container.ts apps/cli/test/unit/infra/player/PlayerServiceImpl.test.ts apps/cli/test/unit/app/playback-phase-events.test.ts
git commit -m "fix(playback): correlate traced player evidence"
```

## Task 3: Real Provider Attempts, Retries And Fallback Evidence

**Purpose:** Replace retrospective fake-order timelines with real physical-attempt evidence, without moving UI policy into `@kunai/core`.

**Files:**

- Modify: `packages/core/src/provider-engine.ts`
- Modify: `packages/core/test/core.test.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: `apps/cli/src/services/diagnostics/operation-taxonomy.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts`

- [ ] **Step 1: Write failing core observer tests**

Add an engine observer contract that tests real attempts rather than provider-level summaries:

```ts
test("ProviderEngine observes physical retries with real elapsed timestamps", async () => {
  const events: ProviderEngineEvent[] = [];
  const engine = createProviderEngine({
    modules: [retryThenSuccessModule],
    maxAttempts: 2,
    retryDelayMs: 0,
    now: () => nextTime(),
  });

  await engine.resolveWithFallback(input, ["vidking"], undefined, (event) => events.push(event));

  expect(events.map((event) => event.type)).toEqual([
    "provider-attempt-started",
    "provider-attempt-failed",
    "provider-retry-scheduled",
    "provider-attempt-started",
    "provider-attempt-succeeded",
  ]);
  expect(events[1]).toMatchObject({ providerId: "vidking", attempt: 1 });
});

test("ProviderEngine observes a provider fallback after primary exhaustion", async () => {
  expect(events.some((event) => event.type === "provider-fallback-started")).toBe(true);
});
```

- [ ] **Step 2: Write failing coordinator diagnostics tests**

Assert app diagnostics receives incremental correlated evidence:

```ts
expect(recorded).toContainEqual(
  expect.objectContaining({
    operation: "provider.resolve.attempt",
    playbackCycleId: "cycle-1",
    providerAttemptId: "provider-1",
    context: expect.objectContaining({ phase: "failed", physicalAttempt: 1 }),
  }),
);
expect(recorded).toContainEqual(
  expect.objectContaining({
    operation: "provider.resolve.fallback",
    context: expect.objectContaining({ fromProviderId: "vidking", toProviderId: "rivestream" }),
  }),
);
```

- [ ] **Step 3: Run focused tests to see the missing observer fail**

Run:

```sh
bun run --cwd packages/core test
bun run --cwd apps/cli test:unit
```

Expected: FAIL because the provider engine exposes only completed provider-level attempts and the taxonomy has no live attempt/fallback operations.

- [ ] **Step 4: Add provider engine evidence events**

Define core-neutral facts in `provider-engine.ts`:

```ts
export type ProviderEngineEvent =
  | {
      readonly type: "provider-attempt-started";
      readonly providerId: ProviderId;
      readonly attempt: number;
      readonly at: string;
    }
  | {
      readonly type: "provider-attempt-succeeded";
      readonly providerId: ProviderId;
      readonly attempt: number;
      readonly at: string;
      readonly elapsedMs: number;
    }
  | {
      readonly type: "provider-attempt-failed";
      readonly providerId: ProviderId;
      readonly attempt: number;
      readonly at: string;
      readonly elapsedMs: number;
      readonly failure: ProviderFailure;
    }
  | {
      readonly type: "provider-retry-scheduled";
      readonly providerId: ProviderId;
      readonly nextAttempt: number;
      readonly at: string;
      readonly delayMs: number;
    }
  | {
      readonly type: "provider-fallback-started";
      readonly fromProviderId: ProviderId;
      readonly toProviderId: ProviderId;
      readonly at: string;
      readonly failure: ProviderFailure;
    };

export type ProviderEngineObserver = (event: ProviderEngineEvent) => void;
```

Add an optional observer to `resolve()` and `resolveWithFallback()` and emit facts immediately at their existing control points. Use a constructor-injected `now`/clock only if tests need deterministic elapsed math; do not manufacture ordinal timestamps.

- [ ] **Step 5: Project core facts into app diagnostics**

Extend `PlaybackResolveEvent` with a single safe observer event or explicit attempt/fallback variants, then record operations in `PlaybackResolveCoordinator`:

```ts
this.deps.diagnostics.record({
  ...input.correlation,
  category: "provider",
  operation:
    event.type === "provider-fallback-started"
      ? "provider.resolve.fallback"
      : "provider.resolve.attempt",
  message: describeProviderAttemptEvidence(event),
  providerId: activeProviderId(event),
  titleId: input.title.id,
  season: input.episode.season,
  episode: input.episode.episode,
  context: safeProviderAttemptContext(event),
});
```

Add catalog entries:

```ts
{ operation: "provider.resolve.attempt", category: "provider", audience: "both",
  summary: "A physical provider resolve attempt changed state with measured time." },
{ operation: "provider.resolve.fallback", category: "provider", audience: "both",
  summary: "Provider resolution moved to another provider after classified failure." },
```

Keep `provider.resolve.timeline` as a final summary, now composed from real events rather than synthetic ordering.

- [ ] **Step 6: Run provider evidence tests**

Run:

```sh
bun run --cwd packages/core test
bun run --cwd apps/cli test:unit
```

Expected: PASS.

- [ ] **Step 7: Commit provider timing evidence**

```sh
git add packages/core/src/provider-engine.ts packages/core/test/core.test.ts apps/cli/src/services/playback/PlaybackResolveService.ts apps/cli/src/services/playback/PlaybackResolveCoordinator.ts apps/cli/src/services/diagnostics/operation-taxonomy.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts
git commit -m "feat(diagnostics): trace physical provider attempts"
```

## Task 4: Classified Subtitle Delivery And Stream Reuse Provenance

**Purpose:** Preserve playable-first UX while explaining subtitle outcomes and reused-stream ownership accurately.

**Files:**

- Modify: `apps/cli/src/infra/player/persistent-subtitle-manager.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/diagnostics/operation-taxonomy.ts`
- Test: `apps/cli/test/unit/infra/player/persistent-subtitle-manager.test.ts`
- Test: `apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts`
- Test: `apps/cli/test/unit/app/playback-phase-events.test.ts`

- [ ] **Step 1: Write failing subtitle outcome tests**

Replace count-only expectations with classified results:

```ts
expect(await manager.attachSubtitles(null, attachment)).toEqual({
  status: "no-ipc",
  attachedCount: 0,
});

expect(await manager.attachSubtitles(failingIpc, attachment)).toEqual({
  status: "sub-add-failed",
  attachedCount: 0,
  failedTrack: "primary",
});
```

Add a playback-phase test proving a late readiness timeout emits:

```ts
expect(events).toContainEqual(
  expect.objectContaining({
    operation: "subtitle.attach.outcome",
    context: expect.objectContaining({ outcome: "player-ready-timeout", delivery: "late" }),
  }),
);
```

- [ ] **Step 2: Write failing reuse provenance test**

Exercise a fallback-selected stream saved for recent backward navigation:

```ts
expect(reuseEvent).toMatchObject({
  operation: "playback.stream.reused",
  providerId: "rivestream",
  context: {
    provenance: "recent-memory",
    selectedProviderId: "vidking",
    resolvedProviderId: "rivestream",
  },
});
```

- [ ] **Step 3: Run the failing focused tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: FAIL because subtitle attachment returns counts/void and recent stream reuse is not diagnosed with original provider provenance.

- [ ] **Step 4: Add classified subtitle results**

Introduce a narrow result type:

```ts
export type SubtitleAttachmentResult =
  | { readonly status: "attached"; readonly attachedCount: number }
  | { readonly status: "none-requested"; readonly attachedCount: 0 }
  | { readonly status: "no-ipc"; readonly attachedCount: 0 }
  | {
      readonly status: "sub-add-failed";
      readonly attachedCount: number;
      readonly failedTrack: "primary" | "additional";
    };
```

Return it from persistent attachment methods and translate it at the policy boundary into:

```ts
diagnosticsService.record({
  ...correlation,
  category: "subtitle",
  operation: "subtitle.attach.outcome",
  message: "Subtitle attachment outcome",
  providerId,
  context: {
    outcome: result.status,
    delivery: "initial" | "late",
    attachedCount: result.attachedCount,
  },
});
```

Record lookup failure and player-ready timeout through the same operation with distinct `outcome` values.

- [ ] **Step 5: Preserve and report stream provenance**

Store recent stream records with resolved provenance instead of only `StreamInfo`:

```ts
type RecentEpisodeStream = {
  readonly stream: StreamInfo;
  readonly resolvedProviderId: string;
  readonly provenance: "fresh" | "cache" | "prefetch" | "fallback";
};
```

When reusing, retain `resolvedProviderId` and record:

```ts
diagnosticsService.record({
  ...playbackCorrelation,
  category: "cache",
  operation: "playback.stream.reused",
  message: "Using in-memory recent episode stream",
  providerId: recent.resolvedProviderId,
  context: {
    provenance: "recent-memory",
    selectedProviderId: providerId,
    resolvedProviderId: recent.resolvedProviderId,
  },
});
```

Add operation catalog entries for `subtitle.attach.outcome` and `playback.stream.reused`.

- [ ] **Step 6: Run subtitle and provenance tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: PASS.

- [ ] **Step 7: Commit classified optional-richness evidence**

```sh
git add apps/cli/src/infra/player/persistent-subtitle-manager.ts apps/cli/src/infra/player/PlayerControlServiceImpl.ts apps/cli/src/app/PlaybackPhase.ts apps/cli/src/services/diagnostics/operation-taxonomy.ts apps/cli/test/unit/infra/player/persistent-subtitle-manager.test.ts apps/cli/test/unit/infra/player/PlayerControlServiceImpl.test.ts apps/cli/test/unit/app/playback-phase-events.test.ts apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts
git commit -m "feat(diagnostics): classify subtitle and reuse outcomes"
```

## Task 5: Resolve-Work Retention And Production Export

**Purpose:** Make request-economy evidence available in a real support bundle rather than only pure builder tests.

**Files:**

- Modify: `apps/cli/src/services/diagnostics/DiagnosticsService.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Test: `apps/cli/test/unit/services/diagnostics/diagnostics-service.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-work-service.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`

- [ ] **Step 1: Write failing completed-ledger retention tests**

Add a diagnostics service test:

```ts
service.recordResolveWorkLedger(completedLedger);
expect(service.buildSupportBundle().insights.resolveWork).toMatchObject({
  physicalWork: [expect.objectContaining({ resolveWorkKey: completedLedger.resolveWorkKey })],
});
```

Add a work-service integration test:

```ts
const completed: ResolveWorkLedgerSnapshot[] = [];
const service = new PlaybackResolveWorkService(coordinator, {
  onCompletedLedger: (ledger) => completed.push(ledger),
});
await service.resolve(input, { intentKind: "playback", budgetLane: "user-blocking" });
expect(completed).toHaveLength(1);
```

- [ ] **Step 2: Run failing tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: FAIL because production services do not retain or export completed ledgers.

- [ ] **Step 3: Add a bounded service-owned ledger buffer**

Extend `DiagnosticsService`:

```ts
recordResolveWorkLedger(ledger: ResolveWorkLedgerSnapshot): void;
```

Implement bounded retention in `DiagnosticsServiceImpl`:

```ts
private readonly resolveWorkLedgers: ResolveWorkLedgerSnapshot[] = [];
private static readonly MAX_RESOLVE_WORK_LEDGERS = 20;

recordResolveWorkLedger(ledger: ResolveWorkLedgerSnapshot): void {
  this.resolveWorkLedgers.push(ledger);
  if (this.resolveWorkLedgers.length > DiagnosticsServiceImpl.MAX_RESOLVE_WORK_LEDGERS) {
    this.resolveWorkLedgers.splice(
      0,
      this.resolveWorkLedgers.length - DiagnosticsServiceImpl.MAX_RESOLVE_WORK_LEDGERS,
    );
  }
}
```

Pass those snapshots to the existing bundle builder:

```ts
return buildDiagnosticsBundle({
  ...input,
  events: this.deps.store.getSnapshot(),
  resolveWorkLedgers: this.resolveWorkLedgers,
});
```

Extend `PlaybackResolveWorkService` options:

```ts
constructor(
  private readonly coordinator: ResolveCoordinator,
  private readonly options: {
    readonly onCompletedLedger?: (ledger: ResolveWorkLedgerSnapshot) => void;
  } = {},
) {}
```

Invoke it after `finalizeResolveWorkLedger`, and wire it to `diagnosticsService.recordResolveWorkLedger` in `container.ts`.

- [ ] **Step 4: Verify exports use actual service evidence**

The existing `/export-diagnostics` and `/report-issue` call `diagnosticsService.buildSupportBundle()`. Add a workflow-level assertion if there is an adjacent workflow harness; otherwise prove the service contract and retain the workflow unchanged.

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: PASS.

- [ ] **Step 5: Commit exported request-economy evidence**

```sh
git add apps/cli/src/services/diagnostics/DiagnosticsService.ts apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts apps/cli/src/services/playback/PlaybackResolveWorkService.ts apps/cli/src/container.ts apps/cli/src/app-shell/workflows.ts apps/cli/test/unit/services/diagnostics/diagnostics-service.test.ts apps/cli/test/unit/services/playback/playback-resolve-work-service.test.ts apps/cli/test/unit/services/diagnostics/support-bundle.test.ts
git commit -m "feat(diagnostics): export resolve work evidence"
```

## Task 6: Diagnostics Panel Truthfulness And Correlation

**Purpose:** Surface the evidence in a readable panel with truthful unknown states.

**Files:**

- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/runtime-bindings.ts`
- Modify: `apps/cli/src/services/diagnostics/runtime-health.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/runtime-health.test.ts`

- [ ] **Step 1: Write failing panel tests**

Add representative correlated events:

```ts
const lines = buildDiagnosticsPanelLines({
  state,
  recentEvents: [
    startupEvent({
      playbackCycleId: "cycle-42",
      providerAttemptId: "provider-42",
      traceId: "trace-42",
    }),
    providerAttemptEvent({ elapsedMs: 742, phase: "failed" }),
    providerFallbackEvent({ elapsedMs: 18, toProviderId: "rivestream" }),
    subtitleOutcomeEvent({ outcome: "attached", delivery: "late" }),
  ],
  downloadSummary: null,
});

expect(lines).toContainEqual(
  expect.objectContaining({ label: "Correlation", detail: expect.stringContaining("cycle-42") }),
);
expect(lines).toContainEqual(
  expect.objectContaining({ label: "Slowest stage", detail: expect.any(String) }),
);
expect(lines).toContainEqual(
  expect.objectContaining({ label: "Subtitles", detail: expect.stringContaining("late") }),
);
expect(lines).toContainEqual(
  expect.objectContaining({
    label: "Downloads",
    detail: expect.stringContaining("Unknown"),
    tone: "neutral",
  }),
);
```

- [ ] **Step 2: Run failing panel tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: FAIL because IDs, slowest stage, structured attempt rows, subtitle outcome and unknown download status are not projected.

- [ ] **Step 3: Add compact active-cycle projection helpers**

In `panel-data.ts`, add pure formatters:

```ts
function findActiveCorrelation(events: readonly DiagnosticEvent[]): DiagnosticCorrelation | null;
function formatCorrelation(correlation: DiagnosticCorrelation | null): string;
function findSlowestStartupStage(event: DiagnosticEvent | undefined): string;
function formatProviderAttemptEvidence(events: readonly DiagnosticEvent[]): string;
function formatSubtitleOutcome(events: readonly DiagnosticEvent[]): string;
```

Use existing normalized event context, and only display compact identifiers and safe provider facts:

```ts
{
  label: "Correlation",
  detail: formatCorrelation(findActiveCorrelation(recentEvents)),
  tone: "neutral",
},
{
  label: "Slowest stage",
  detail: findSlowestStartupStage(playbackStartupEvent),
  tone: playbackStartupEvent ? "info" : "neutral",
},
```

Change missing download state from reassurance to honesty:

```ts
detail: downloadSummary ? formatDownloadStatus(downloadSummary) : "Unknown  ·  queue status unavailable",
tone: downloadSummary ? downloadTone(downloadSummary) : "neutral",
```

Filter or prioritize active-cycle provider/playback events in the detailed rows while retaining the bounded event list for the whole session.

- [ ] **Step 4: Run panel tests**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: PASS.

- [ ] **Step 5: Commit the diagnostics inspector presentation**

```sh
git add apps/cli/src/app-shell/panel-data.ts apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/src/app-shell/runtime-bindings.ts apps/cli/src/services/diagnostics/runtime-health.ts apps/cli/test/unit/app-shell/panel-data.test.ts apps/cli/test/unit/services/diagnostics/runtime-health.test.ts
git commit -m "feat(diagnostics): surface correlated runtime evidence"
```

## Task 7: Migrate Remaining Active Runtime Diagnostic Writers

**Purpose:** Remove the remaining split-brain output behavior after the critical playback path is proven.

**Files:**

- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/app/SearchPhase.ts`
- Modify: `apps/cli/src/app/DownloadOnlyPhase.ts`
- Modify: `apps/cli/src/app/SessionController.ts`
- Modify: `apps/cli/src/app/launch-entry.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/runtime-bindings.ts`
- Modify: `apps/cli/src/infra/work/WorkControlServiceImpl.ts`
- Modify: `apps/cli/src/services/attention/AttentionRefreshWorker.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/services/persistence/StorageMaintenanceService.ts`
- Modify: `apps/cli/src/services/playback/SourceInventoryService.ts`
- Modify: `apps/cli/src/services/presence/PresenceServiceImpl.ts`
- Modify: `apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts`
- Test: corresponding existing unit tests in `apps/cli/test/unit/`

- [ ] **Step 1: Add a deterministic guard test for active writable store bypasses**

Create `apps/cli/test/unit/services/diagnostics/diagnostic-recorder-boundary.test.ts` to scan active runtime source files and permit `diagnosticsStore` only for reading/snapshot/export assembly and inside diagnostics implementation:

```ts
const allowedWritableStoreFiles = new Set([
  "services/diagnostics/DiagnosticsServiceImpl.ts",
  "services/diagnostics/DiagnosticsStoreImpl.ts",
]);

expect(findActiveRuntimeWritableDiagnosticsStoreCalls()).toEqual([]);
```

Keep the scanner explicit: flag `.diagnosticsStore.record(` and destructured `diagnosticsStore.record(` call sites outside the allowed implementation files; do not reject `getRecent()` or `getSnapshot()` reads.

- [ ] **Step 2: Run the boundary test to list current bypasses**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: FAIL and enumerate active writer paths still bypassing the service.

- [ ] **Step 3: Migrate service and app constructors to recorder dependencies**

Use:

```ts
type DiagnosticRecorder = Pick<DiagnosticsService, "record">;
```

Replace writable dependency names with `diagnostics` where the dependency is write-only:

```ts
constructor(private readonly deps: { readonly diagnostics?: DiagnosticRecorder }) {}

this.deps.diagnostics?.record({
  category: "download",
  operation: "download.artifact.repairable",
  message: "Download completed with repairable sidecar",
  context: safeContext,
});
```

In orchestration files that already have `container.diagnosticsService`, replace writes directly:

```ts
container.diagnosticsService.record(event);
```

Do not migrate panel/export reads that legitimately need `diagnosticsStore.getRecent()` or `getSnapshot()`.

- [ ] **Step 4: Update affected tests to pass recorder fakes**

Existing service tests can use the same minimal fake:

```ts
function createDiagnosticsRecorder() {
  const events: DiagnosticEventInput[] = [];
  return {
    events,
    record: (event: DiagnosticEventInput) => events.push(event),
  };
}
```

Retain tests asserting operation names and redacted-safe context; avoid asserting incidental constructor property names.

- [ ] **Step 5: Run migrated subsystem tests and boundary test**

Run:

```sh
bun run --cwd apps/cli test:unit
```

Expected: PASS, and the boundary test proves no active-runtime writable bypass remains outside diagnostics internals.

- [ ] **Step 6: Commit full-runtime ingestion convergence**

```sh
git add apps/cli/src/main.ts apps/cli/src/app/SearchPhase.ts apps/cli/src/app/DownloadOnlyPhase.ts apps/cli/src/app/SessionController.ts apps/cli/src/app/launch-entry.ts apps/cli/src/app-shell/workflows.ts apps/cli/src/app-shell/runtime-bindings.ts apps/cli/src/infra/work/WorkControlServiceImpl.ts apps/cli/src/services/attention/AttentionRefreshWorker.ts apps/cli/src/services/download/DownloadService.ts apps/cli/src/services/persistence/StorageMaintenanceService.ts apps/cli/src/services/playback/SourceInventoryService.ts apps/cli/src/services/presence/PresenceServiceImpl.ts apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts apps/cli/test/unit/services/diagnostics/diagnostic-recorder-boundary.test.ts apps/cli/test/unit/services/download/download-service.test.ts apps/cli/test/unit/services/presence/PresenceServiceImpl.test.ts apps/cli/test/unit/services/persistence/StorageMaintenanceService.test.ts apps/cli/test/unit/services/playback/source-inventory-service.test.ts apps/cli/test/unit/app/download-only-phase.test.ts apps/cli/test/unit/app/session-controller-shutdown.test.ts apps/cli/test/unit/services/release-reconciliation/enqueue-release-reconciliation.test.ts
git commit -m "refactor(diagnostics): route active runtime evidence consistently"
```

## Task 8: Documentation, Deterministic Gates And Manual Runtime Proof

**Purpose:** Make the new observability path usable during future provider drift and prove it without turning network checks into routine automation.

**Files:**

- Modify: `.docs/diagnostics-guide.md`
- Modify: `.docs/debugging-map.md`
- Modify if implementation status changes: `.plans/plan-implementation-truth.md`

- [ ] **Step 1: Update documentation with the implemented evidence flow**

Document only behavior that is actually present after Tasks 1-7:

```md
Use `--debug-json` when reproducing provider/playback issues: active-runtime
diagnostic events flow through the same redacted ingestion path as
`/diagnostics` and `/export-diagnostics`.

For latency triage, read in this order:

1. Startup path and slowest completed stage.
2. Correlated physical provider attempts/retries/fallbacks.
3. Stream provenance and cache/prefetch/reuse decision.
4. mpv readiness/stall/reconnect evidence.
5. Subtitle outcome, which may arrive after playback begins.
```

Describe privacy guarantees and the difference between deterministic tests and manual live checks.

- [ ] **Step 2: Run formatting and deterministic verification**

Run:

```sh
bun run fmt
bun run lint
bun run typecheck
bun run test
bun run build
```

Expected: PASS for all commands.

- [ ] **Step 3: Perform one bounded manual app verification**

Run locally with a real terminal/mpv session:

```sh
bun run dev -- -i 76479 -t tv --debug-json
```

Select one VidKing or Rivestream episode, allow playback progress, and open `/diagnostics`. Verify:

- startup path reaches first observed progress and identifies the slowest stage;
- provider physical attempts show real elapsed timing;
- correlation identifiers are visible;
- no raw media or subtitle locations are shown;
- `/export-diagnostics` includes the corresponding correlated evidence and resolve-work insight.

For anime provider behavior, perform one optional targeted run:

```sh
bun run dev -- -S "Solo Leveling" -a --debug-json
```

Verify AllManga or Miruro playback/subtitle evidence only once deterministic gates pass; do not loop live-provider testing during implementation.

- [ ] **Step 4: Commit documentation and any plan-truth reconciliation**

```sh
git add .docs/diagnostics-guide.md .docs/debugging-map.md .plans/plan-implementation-truth.md
git commit -m "docs: document correlated runtime diagnostics"
```

If `.plans/plan-implementation-truth.md` did not require a truthful status change, omit it from `git add`.

## Final Review Checklist

- [ ] Run `rg -n "diagnosticsStore\\.record|diagnosticsStore\\?\\.record" apps/cli/src -g'*.ts' -g'*.tsx'` and confirm only intentional diagnostics implementation exceptions remain.
- [ ] Run `rg -n "url: playbackStream\\.url|Subtitle attached: \\$\\{|subtitleUrl:" apps/cli/src -g'*.ts' -g'*.tsx'` and confirm no raw playback diagnostic leak remains.
- [ ] Confirm physical provider-attempt evidence uses real timings and does not retain the prior synthetic `index * 2` timeline behavior.
- [ ] Confirm startup measurement still ends at first observed progress and does not include viewing duration or late subtitle completion.
- [ ] Confirm unknown health state is neutral rather than presented as success.
- [ ] Confirm exports include bounded resolve-work evidence and correlation identifiers.
- [ ] Confirm deterministic gates pass before any single manual live provider/mpv check.
