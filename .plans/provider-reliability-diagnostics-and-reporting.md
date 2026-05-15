# Provider Reliability, Diagnostics, And Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider failures, retries, fallback, debugging, diagnostics export, and issue reporting structured, visible, recoverable, and memory-safe.

**Architecture:** Provider resolution emits a bounded `ProviderAttemptTimeline` with trace IDs, attempt IDs, failure classes, retry/fallback transitions, and recovery summaries. Diagnostics, loading UI, debug logs, export JSON, and `/report-issue` all consume one shared redacted diagnostics bundle instead of inventing separate copies of provider state.

**Tech Stack:** Bun, TypeScript, Ink shell, existing `DiagnosticsStore`, provider SDK contracts, SQLite-backed stores, `bun test`, `oxlint`, `oxfmt`.

---

## Status

Core implementation completed on `main`.

Implemented:

- Bounded `ProviderAttemptTimeline` and canonical provider failure classification.
- Redaction-at-record-time for diagnostics with bounded messages and context strings.
- Redacted diagnostics bundle builder shared by export/report/debug flows.
- Provider resolve timeline summaries recorded through diagnostics.
- Loading copy no longer presents retry/fallback progress as a final error.
- Preview-first `/report-issue` flow.
- `--debug-json` with optional `KUNAI_TRACE=category,category` JSONL trace filtering.
- Diagnostics guide updated with trace, redaction, and report flow usage.

Follow-up hardening still worth doing:

- Rotate old diagnostics exports and trace files to enforce the latest-10 retention policy.
- Add a richer `/diagnostics` panel section that renders the full provider attempt timeline, not just the summary event.
- Add an issue-report preview screen that shows bundle contents before export, instead of only describing the action in the picker.

## Decisions Locked By Grill Session

- Provider errors must never be swallowed.
- Automatic fallback is allowed by default, but it must be guided and visible.
- Fallback progress is not a final error.
- Fallback success must preserve the primary provider failure in diagnostics.
- Final failure must show all provider attempts and clear next actions.
- `/diagnostics`, `/export-diagnostics`, and `/report-issue` must share one diagnostics bundle builder.
- `/report-issue` is preview-first and only writes/exports after explicit confirmation.
- Developer debugging must use structured trace IDs and scoped categories.
- Diagnostics memory must be bounded and safe for long sessions.
- Normal mode keeps bounded in-memory diagnostics only.
- `--debug` may write readable logs.
- `--debug-json` may write newline-delimited JSON trace files using streaming append.
- URL redaction must keep host/path shape/query keys while redacting secrets.
- URL and path redaction happens before diagnostics storage and again before export/report.

## Non-Goals

- Do not redesign provider scraping in this plan.
- Do not add new providers in this plan.
- Do not make fallback silent.
- Do not store raw provider HTML/JSON payloads by default.
- Do not write diagnostics files automatically from `/report-issue` before user confirmation.
- Do not make diagnostics arrays or trace timelines unbounded.

## Global Contracts

- Retryable primary provider failure auto-fallbacks with visible progress.
- Non-retryable missing input, user cancellation, and runtime-missing failures do not fallback automatically.
- Guided failures show a provider picker or next action instead of looping.
- Loading copy uses calm recovery language while work is still ongoing.
- Final failure copy appears only after all configured attempts are exhausted.
- Every exported issue/debug bundle includes Kunai version, provider id, provider runtime, failure class, fallback timeline, cache status, manifest/url summary when available, and safe reproduction context.
- Reports never include cookies, authorization headers, signed query values, Discord client IDs, raw stream URLs, raw subtitle URLs, raw provider payloads, or private full filesystem prefixes.

## Failure Classification

Add the following canonical failure classes:

```ts
export type ProviderFailureClass =
  | "timeout"
  | "network"
  | "rate-limited"
  | "provider-empty"
  | "provider-parse"
  | "expired-stream"
  | "unsupported-title"
  | "missing-input"
  | "user-cancelled"
  | "runtime-missing"
  | "blocked"
  | "sub-dub-mismatch"
  | "title-episode-gap"
  | "unknown";
```

Fallback policy:

- Auto fallback: `timeout`, `network`, `rate-limited`, `provider-empty`, `provider-parse`, `expired-stream`.
- Guided action: `blocked`, `sub-dub-mismatch`, `title-episode-gap`.
- No auto fallback: `missing-input`, `user-cancelled`, `runtime-missing`, `unsupported-title` when the provider clearly cannot support the selected media kind.

## Memory And Retention Policy

Runtime memory caps:

- Diagnostics ring buffer: max 500 events.
- Provider timeline attempts: max 20 attempts.
- Provider timeline events: max 50 events per trace.
- Event message: max 500 chars.
- Context string value: max 1,000 chars.
- Serialized event context: max 8 KB.
- Timeline serialized size target: max 64 KB.
- Diagnostics bundle target: less than 512 KB unless explicitly exporting a deeper local file.

Persistent retention:

- `./logs.txt` remains the readable debug log sink when enabled.
- Diagnostics exports live under platform state diagnostics directory.
- JSONL traces live under platform state traces directory.
- Keep latest 10 diagnostics exports and latest 10 trace files unless the user selected an explicit custom export path.

## File Ownership Map

- Create `apps/cli/src/domain/provider/ProviderAttemptTimeline.ts`: pure timeline model, attempt events, summaries, caps, failure policy.
- Create `apps/cli/src/domain/provider/ProviderFailureClassifier.ts`: maps provider failures/errors to canonical failure class and fallback policy.
- Create `apps/cli/src/services/diagnostics/redaction.ts`: URL/path/header/string redaction helpers used before storage and before export/report.
- Create `apps/cli/src/services/diagnostics/DiagnosticsBundleBuilder.ts`: builds one redacted structured bundle for diagnostics, export, report issue, and debug.
- Create `apps/cli/src/services/diagnostics/DebugTraceReporter.ts`: human-readable and JSONL debug emission with trace/category filtering.
- Modify `apps/cli/src/services/diagnostics/DiagnosticsStore.ts`: enforce ring buffer cap and redaction-at-record-time.
- Modify `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`: emit trace/timeline events for cache decisions, provider attempts, fallback transitions, and final failure.
- Modify provider fallback orchestration currently used by playback/session flow: preserve all attempt summaries instead of only latest issue.
- Modify `apps/cli/src/app-shell/loading-shell-runtime.ts`: render timeline progress/recovery/failure copy.
- Modify `apps/cli/src/app-shell/panel-data.ts`: show provider timeline summary and report/export hints.
- Modify `apps/cli/src/app-shell/workflows.ts`: add `/report-issue` guided flow.
- Modify `apps/cli/src/main.ts`: parse `--debug-json` and scoped `KUNAI_TRACE`.
- Modify `.docs/diagnostics-guide.md`: document trace IDs, report flow, redaction, and debugging commands.
- Test files live under `apps/cli/test/unit/domain/provider/`, `apps/cli/test/unit/services/diagnostics/`, `apps/cli/test/unit/services/playback/`, and `apps/cli/test/unit/app-shell/`.

## Task 1: Provider Attempt Timeline Domain

**Files:**

- Create: `apps/cli/src/domain/provider/ProviderAttemptTimeline.ts`
- Test: `apps/cli/test/unit/domain/provider/provider-attempt-timeline.test.ts`

- [ ] **Step 1: Write failing timeline tests**

Add tests covering attempt start, failure, fallback, success, final failure, max attempts, max events, and user-facing summary:

```ts
import { describe, expect, test } from "bun:test";

import {
  createProviderAttemptTimeline,
  summarizeProviderAttemptTimeline,
} from "@/domain/provider/ProviderAttemptTimeline";

describe("ProviderAttemptTimeline", () => {
  test("records primary failure, fallback transition, and fallback success", () => {
    const timeline = createProviderAttemptTimeline({ traceId: "trace-1", maxAttempts: 20 });
    timeline.record({
      type: "attempt-started",
      attemptId: "a1",
      providerId: "vidking",
      reason: "primary",
      at: 1,
    });
    timeline.record({
      type: "attempt-failed",
      attemptId: "a1",
      providerId: "vidking",
      at: 2,
      failureClass: "timeout",
      retryable: true,
      userSummary: "VidKing timed out",
      developerDetail: "provider request exceeded 15000ms",
    });
    timeline.record({
      type: "fallback-started",
      attemptId: "a2",
      fromProviderId: "vidking",
      toProviderId: "rivestream",
      reason: "timeout",
      at: 3,
    });
    timeline.record({
      type: "attempt-succeeded",
      attemptId: "a2",
      providerId: "rivestream",
      at: 4,
      cacheHit: false,
      streamCount: 2,
    });

    const summary = summarizeProviderAttemptTimeline(timeline.snapshot());
    expect(summary.status).toBe("recovered");
    expect(summary.primaryFailure).toContain("VidKing timed out");
    expect(summary.currentUserMessage).toContain("Recovered via Rivestream");
    expect(summary.attempts).toHaveLength(2);
  });

  test("caps attempts and events for long sessions", () => {
    const timeline = createProviderAttemptTimeline({
      traceId: "trace-long",
      maxAttempts: 3,
      maxEvents: 5,
    });
    for (let i = 0; i < 10; i++) {
      timeline.record({
        type: "attempt-started",
        attemptId: `a${i}`,
        providerId: `p${i}`,
        reason: "fallback",
        at: i,
      });
      timeline.record({
        type: "attempt-failed",
        attemptId: `a${i}`,
        providerId: `p${i}`,
        at: i + 0.5,
        failureClass: "network",
        retryable: true,
        userSummary: "Network failed",
        developerDetail: "synthetic network failure",
      });
    }

    const snapshot = timeline.snapshot();
    expect(snapshot.attempts.length).toBeLessThanOrEqual(3);
    expect(snapshot.events.length).toBeLessThanOrEqual(5);
    expect(snapshot.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
bun test apps/cli/test/unit/domain/provider/provider-attempt-timeline.test.ts
```

Expected: fail because `ProviderAttemptTimeline` does not exist.

- [ ] **Step 3: Implement timeline model**

Implement exported types and functions in `ProviderAttemptTimeline.ts`:

```ts
export type ProviderAttemptReason = "primary" | "retry" | "fallback" | "manual";
export type ProviderTimelineStatus =
  | "idle"
  | "resolving"
  | "recovering"
  | "resolved"
  | "recovered"
  | "failed";
export type ProviderFailureClass =
  | "timeout"
  | "network"
  | "rate-limited"
  | "provider-empty"
  | "provider-parse"
  | "expired-stream"
  | "unsupported-title"
  | "missing-input"
  | "user-cancelled"
  | "runtime-missing"
  | "blocked"
  | "sub-dub-mismatch"
  | "title-episode-gap"
  | "unknown";

export type ProviderAttemptTimelineEvent =
  | {
      type: "attempt-started";
      traceId?: string;
      attemptId: string;
      providerId: string;
      reason: ProviderAttemptReason;
      at: number;
    }
  | {
      type: "attempt-failed";
      traceId?: string;
      attemptId: string;
      providerId: string;
      at: number;
      failureClass: ProviderFailureClass;
      retryable: boolean;
      userSummary: string;
      developerDetail: string;
    }
  | {
      type: "fallback-started";
      traceId?: string;
      attemptId: string;
      fromProviderId: string;
      toProviderId: string;
      reason: string;
      at: number;
    }
  | {
      type: "attempt-succeeded";
      traceId?: string;
      attemptId: string;
      providerId: string;
      at: number;
      cacheHit: boolean;
      streamCount: number;
    }
  | { type: "all-attempts-failed"; traceId?: string; at: number };

export type ProviderAttemptSummary = {
  readonly attemptId: string;
  readonly providerId: string;
  readonly reason: ProviderAttemptReason;
  readonly status: "started" | "failed" | "succeeded";
  readonly failureClass?: ProviderFailureClass;
  readonly retryable?: boolean;
  readonly userSummary?: string;
};

export type ProviderAttemptTimelineSnapshot = {
  readonly traceId: string;
  readonly status: ProviderTimelineStatus;
  readonly attempts: readonly ProviderAttemptSummary[];
  readonly events: readonly ProviderAttemptTimelineEvent[];
  readonly truncated: boolean;
};

export function createProviderAttemptTimeline(input: {
  readonly traceId: string;
  readonly maxAttempts?: number;
  readonly maxEvents?: number;
}) {
  const maxAttempts = input.maxAttempts ?? 20;
  const maxEvents = input.maxEvents ?? 50;
  let status: ProviderTimelineStatus = "idle";
  let truncated = false;
  const attempts = new Map<string, ProviderAttemptSummary>();
  const events: ProviderAttemptTimelineEvent[] = [];

  function cap(): void {
    while (events.length > maxEvents) {
      events.shift();
      truncated = true;
    }
    while (attempts.size > maxAttempts) {
      const firstKey = attempts.keys().next().value;
      if (!firstKey) break;
      attempts.delete(firstKey);
      truncated = true;
    }
  }

  return {
    record(event: ProviderAttemptTimelineEvent): void {
      events.push({ ...event, traceId: event.traceId ?? input.traceId });
      if (event.type === "attempt-started") {
        status = event.reason === "fallback" ? "recovering" : "resolving";
        attempts.set(event.attemptId, {
          attemptId: event.attemptId,
          providerId: event.providerId,
          reason: event.reason,
          status: "started",
        });
      } else if (event.type === "fallback-started") {
        status = "recovering";
        attempts.set(event.attemptId, {
          attemptId: event.attemptId,
          providerId: event.toProviderId,
          reason: "fallback",
          status: "started",
        });
      } else if (event.type === "attempt-failed") {
        const previous = attempts.get(event.attemptId);
        attempts.set(event.attemptId, {
          attemptId: event.attemptId,
          providerId: event.providerId,
          reason: previous?.reason ?? "primary",
          status: "failed",
          failureClass: event.failureClass,
          retryable: event.retryable,
          userSummary: event.userSummary,
        });
      } else if (event.type === "attempt-succeeded") {
        const previous = attempts.get(event.attemptId);
        attempts.set(event.attemptId, {
          attemptId: event.attemptId,
          providerId: event.providerId,
          reason: previous?.reason ?? "primary",
          status: "succeeded",
        });
        status = previous?.reason === "fallback" ? "recovered" : "resolved";
      } else if (event.type === "all-attempts-failed") {
        status = "failed";
      }
      cap();
    },
    snapshot(): ProviderAttemptTimelineSnapshot {
      return {
        traceId: input.traceId,
        status,
        attempts: [...attempts.values()],
        events: [...events],
        truncated,
      };
    },
  };
}

export function summarizeProviderAttemptTimeline(snapshot: ProviderAttemptTimelineSnapshot): {
  readonly status: ProviderTimelineStatus;
  readonly currentUserMessage: string;
  readonly primaryFailure: string | null;
  readonly attempts: readonly ProviderAttemptSummary[];
} {
  const firstFailure = snapshot.attempts.find((attempt) => attempt.status === "failed");
  const success = snapshot.attempts.find((attempt) => attempt.status === "succeeded");
  if (snapshot.status === "recovered" && success) {
    return {
      status: snapshot.status,
      currentUserMessage: `Recovered via ${success.providerId}`,
      primaryFailure: firstFailure?.userSummary ?? null,
      attempts: snapshot.attempts,
    };
  }
  if (snapshot.status === "failed") {
    return {
      status: snapshot.status,
      currentUserMessage: "Could not find a playable stream",
      primaryFailure: firstFailure?.userSummary ?? null,
      attempts: snapshot.attempts,
    };
  }
  const latest = snapshot.events.at(-1);
  return {
    status: snapshot.status,
    currentUserMessage:
      latest?.type === "fallback-started"
        ? `${latest.fromProviderId} failed · trying ${latest.toProviderId} fallback`
        : "Finding playable stream",
    primaryFailure: firstFailure?.userSummary ?? null,
    attempts: snapshot.attempts,
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test apps/cli/test/unit/domain/provider/provider-attempt-timeline.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/provider/ProviderAttemptTimeline.ts apps/cli/test/unit/domain/provider/provider-attempt-timeline.test.ts
git commit -m "Add provider attempt timeline model"
```

## Task 2: Failure Classifier And Fallback Policy

**Files:**

- Create: `apps/cli/src/domain/provider/ProviderFailureClassifier.ts`
- Test: `apps/cli/test/unit/domain/provider/provider-failure-classifier.test.ts`

- [ ] **Step 1: Write failing classifier tests**

```ts
import { describe, expect, test } from "bun:test";

import {
  classifyProviderFailure,
  fallbackPolicyForFailureClass,
} from "@/domain/provider/ProviderFailureClassifier";

describe("ProviderFailureClassifier", () => {
  test("classifies timeout and network failures as auto fallback candidates", () => {
    expect(classifyProviderFailure(new Error("request timed out after 15000ms")).failureClass).toBe(
      "timeout",
    );
    expect(fallbackPolicyForFailureClass("timeout")).toBe("auto-fallback");
    expect(classifyProviderFailure(new Error("ECONNRESET")).failureClass).toBe("network");
    expect(fallbackPolicyForFailureClass("network")).toBe("auto-fallback");
  });

  test("classifies missing input and user cancellation as no fallback", () => {
    expect(fallbackPolicyForFailureClass("missing-input")).toBe("no-fallback");
    expect(fallbackPolicyForFailureClass("user-cancelled")).toBe("no-fallback");
    expect(fallbackPolicyForFailureClass("runtime-missing")).toBe("no-fallback");
  });

  test("classifies blocked and inventory mismatch as guided failures", () => {
    expect(fallbackPolicyForFailureClass("blocked")).toBe("guided-action");
    expect(fallbackPolicyForFailureClass("sub-dub-mismatch")).toBe("guided-action");
    expect(fallbackPolicyForFailureClass("title-episode-gap")).toBe("guided-action");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/domain/provider/provider-failure-classifier.test.ts
```

Expected: fail because classifier does not exist.

- [ ] **Step 3: Implement classifier**

```ts
import type { ProviderFailureClass } from "./ProviderAttemptTimeline";

export type FallbackPolicy = "auto-fallback" | "guided-action" | "no-fallback";

export function fallbackPolicyForFailureClass(failureClass: ProviderFailureClass): FallbackPolicy {
  switch (failureClass) {
    case "timeout":
    case "network":
    case "rate-limited":
    case "provider-empty":
    case "provider-parse":
    case "expired-stream":
      return "auto-fallback";
    case "blocked":
    case "sub-dub-mismatch":
    case "title-episode-gap":
      return "guided-action";
    case "missing-input":
    case "user-cancelled":
    case "runtime-missing":
    case "unsupported-title":
      return "no-fallback";
    case "unknown":
    default:
      return "guided-action";
  }
}

export function classifyProviderFailure(error: unknown): {
  readonly failureClass: ProviderFailureClass;
  readonly retryable: boolean;
  readonly userSummary: string;
  readonly developerDetail: string;
} {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();
  const failureClass: ProviderFailureClass = normalized.includes("timeout")
    ? "timeout"
    : normalized.includes("econnreset") ||
        normalized.includes("network") ||
        normalized.includes("fetch failed")
      ? "network"
      : normalized.includes("429")
        ? "rate-limited"
        : normalized.includes("empty") ||
            normalized.includes("no sources") ||
            normalized.includes("no streams")
          ? "provider-empty"
          : normalized.includes("parse") || normalized.includes("decode")
            ? "provider-parse"
            : normalized.includes("expired")
              ? "expired-stream"
              : normalized.includes("unsupported")
                ? "unsupported-title"
                : normalized.includes("missing")
                  ? "missing-input"
                  : normalized.includes("cancel")
                    ? "user-cancelled"
                    : normalized.includes("blocked") ||
                        normalized.includes("captcha") ||
                        normalized.includes("region")
                      ? "blocked"
                      : "unknown";
  return {
    failureClass,
    retryable: fallbackPolicyForFailureClass(failureClass) === "auto-fallback",
    userSummary: userSummaryForFailureClass(failureClass),
    developerDetail: detail,
  };
}

function userSummaryForFailureClass(failureClass: ProviderFailureClass): string {
  switch (failureClass) {
    case "timeout":
      return "Provider timed out";
    case "network":
      return "Provider network request failed";
    case "rate-limited":
      return "Provider rate-limited the request";
    case "provider-empty":
      return "Provider returned no playable streams";
    case "provider-parse":
      return "Provider response could not be parsed";
    case "expired-stream":
      return "Cached stream expired";
    case "blocked":
      return "Provider appears blocked or requires manual action";
    default:
      return "Provider failed";
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/domain/provider/provider-failure-classifier.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/provider/ProviderFailureClassifier.ts apps/cli/test/unit/domain/provider/provider-failure-classifier.test.ts
git commit -m "Classify provider failures for fallback"
```

## Task 3: Redaction Helpers

**Files:**

- Create: `apps/cli/src/services/diagnostics/redaction.ts`
- Test: `apps/cli/test/unit/services/diagnostics/redaction.test.ts`

- [ ] **Step 1: Write failing redaction tests**

```ts
import { describe, expect, test } from "bun:test";

import { redactDiagnosticValue, summarizeSafeUrl } from "@/services/diagnostics/redaction";

describe("diagnostic redaction", () => {
  test("keeps useful URL host and path shape while redacting token values", () => {
    expect(
      summarizeSafeUrl(
        "https://cdn.example.com/hls/show/episode/master.m3u8?token=abc&expires=123&quality=1080",
      ),
    ).toEqual({
      protocol: "https:",
      host: "cdn.example.com",
      pathShape: "/hls/show/episode/master.m3u8",
      extension: "m3u8",
      queryKeys: ["token", "expires", "quality"],
      redactedQueryKeys: ["token", "expires"],
    });
  });

  test("redacts sensitive headers and home paths", () => {
    expect(
      redactDiagnosticValue({
        headers: {
          Authorization: "Bearer secret",
          Cookie: "a=b",
          Referer: "https://site.test/path",
        },
      }),
    ).toEqual({
      headers: {
        Authorization: "[redacted]",
        Cookie: "[redacted]",
        Referer: {
          protocol: "https:",
          host: "site.test",
          pathShape: "/path",
          extension: undefined,
          queryKeys: [],
          redactedQueryKeys: [],
        },
      },
    });
    expect(redactDiagnosticValue("/home/kitsunekode/.local/share/kunai/downloads/File.mp4")).toBe(
      "~/.local/share/kunai/downloads/File.mp4",
    );
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/redaction.test.ts
```

Expected: fail because redaction module does not exist.

- [ ] **Step 3: Implement redaction helpers**

Implement `summarizeSafeUrl`, `redactDiagnosticValue`, string truncation, sensitive query key detection, and path redaction.

Required behavior:

- Keep protocol, host, path shape, file extension, query key names.
- Redact query values for `token`, `expires`, `signature`, `sig`, `auth`, `key`, `session`, `Policy`, `X-Amz-*`.
- Convert home paths to `~/...`.
- For non-Kunai private paths under home, keep basename and redact parent as `~/[redacted]/file.ext`.
- Redact `authorization`, `cookie`, `set-cookie`, `x-api-key`.
- Truncate strings over 1,000 chars with `...[truncated]`.
- Truncate serialized context over 8 KB by replacing deep values with `"[truncated-context]"`.

- [ ] **Step 4: Run redaction tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/redaction.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/diagnostics/redaction.ts apps/cli/test/unit/services/diagnostics/redaction.test.ts
git commit -m "Add diagnostic redaction helpers"
```

## Task 4: Bounded Diagnostics Store

**Files:**

- Modify: `apps/cli/src/services/diagnostics/DiagnosticsStore.ts`
- Test: existing diagnostics store test or create `apps/cli/test/unit/services/diagnostics/diagnostics-store.test.ts`

- [ ] **Step 1: Write failing bounded-store tests**

Test that:

- Store caps at 500 events by default.
- Oldest events are evicted.
- Event contexts are redacted at record time.
- Large messages are truncated.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/diagnostics-store.test.ts
```

Expected: fail for missing caps/redaction.

- [ ] **Step 3: Implement circular ring buffer**

Use circular indexing instead of `Array.shift()` for high event volume. Add constructor options:

```ts
new DiagnosticsStore({ maxEvents: 500, redact: redactDiagnosticValue });
```

Maintain `getRecent(count)` in newest-first order to preserve existing panel expectations.

- [ ] **Step 4: Run store tests and existing diagnostics tests**

```bash
bun test apps/cli/test/unit/services/diagnostics apps/cli/test/unit/app-shell/panel-data.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/diagnostics/DiagnosticsStore.ts apps/cli/test/unit/services/diagnostics/diagnostics-store.test.ts
git commit -m "Bound diagnostic events in memory"
```

## Task 5: Wire Timeline Into Playback Resolve

**Files:**

- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: provider fallback orchestration path used by `apps/cli/src/app/PlaybackPhase.ts` or session flow.
- Test: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

Add tests proving:

- Cache hit records a provider timeline event with `cacheHit: true`.
- Primary failure records `attempt-failed`.
- Fallback start records `fallback-started`.
- Fallback success records recovered state and preserves primary failure.
- Final failure includes all attempts.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts
```

Expected: fail because timeline is not wired.

- [ ] **Step 3: Add trace ID and attempt ID generation**

Use small deterministic helpers in tests:

```ts
type TraceIdFactory = () => string;
type AttemptIdFactory = () => string;
```

Default runtime implementation can use `crypto.randomUUID()`.

- [ ] **Step 4: Emit diagnostics for every timeline event**

Record events in `DiagnosticsStore` with:

```ts
{
  category: "provider",
  operation: "provider-resolve",
  message: "Provider attempt timeline event",
  context: { traceId, event }
}
```

The store redacts context at record time.

- [ ] **Step 5: Run coordinator tests**

```bash
bun test apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/services/playback/PlaybackResolveCoordinator.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts
git commit -m "Record provider attempt timelines during resolve"
```

## Task 6: Loading And Diagnostics UX

**Files:**

- Modify: `apps/cli/src/app-shell/loading-shell-runtime.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Test: `apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`

- [ ] **Step 1: Write failing UX copy tests**

Test expected copy:

- Recovering: `VidKing timed out · trying Rivestream fallback`
- Recovered: `Recovered via Rivestream · VidKing timed out`
- Final failure: `Could not find a playable stream`
- Diagnostics line includes trace ID and attempt summary.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
```

- [ ] **Step 3: Implement loading summary adapter**

Add a pure helper:

```ts
export function formatProviderTimelineForLoading(snapshot: ProviderAttemptTimelineSnapshot): {
  readonly message: string;
  readonly tone: ShellStatusTone;
};
```

Use `info` while resolving, `warning` while recovering, `success` when recovered, and `error` only after final failure.

- [ ] **Step 4: Implement diagnostics panel lines**

Add provider timeline section:

```text
Provider attempts
trace <traceId>
VidKing failed · timeout · retryable
Rivestream succeeded · cache miss · 2 streams
```

- [ ] **Step 5: Run tests**

```bash
bun test apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/loading-shell-runtime.ts apps/cli/src/app-shell/panel-data.ts apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
git commit -m "Show provider fallback timeline in shell"
```

## Task 7: Diagnostics Bundle Builder

**Files:**

- Create: `apps/cli/src/services/diagnostics/DiagnosticsBundleBuilder.ts`
- Test: `apps/cli/test/unit/services/diagnostics/diagnostics-bundle-builder.test.ts`

- [ ] **Step 1: Write failing bundle tests**

Test bundle includes:

- Kunai version.
- Bun version.
- Platform.
- mode/provider/title if known.
- provider attempt timeline.
- capability snapshot.
- cache hit/miss summary if known.
- subtitle summary.
- safe URL summaries.
- no raw secrets.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/diagnostics-bundle-builder.test.ts
```

- [ ] **Step 3: Implement builder**

Create:

```ts
export type DiagnosticsBundle = {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly app: {
    readonly name: "kunai";
    readonly version: string;
    readonly bunVersion: string;
    readonly platform: string;
  };
  readonly session: {
    readonly mode: string;
    readonly provider: string;
    readonly title?: string;
    readonly titleId?: string;
  };
  readonly providerTimeline?: ProviderAttemptTimelineSnapshot;
  readonly capabilities?: unknown;
  readonly recentEvents: readonly DiagnosticEvent[];
};

export function buildDiagnosticsBundle(input: DiagnosticsBundleInput): DiagnosticsBundle;
```

The builder must call export-time redaction even if events were already redacted.

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/diagnostics-bundle-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/diagnostics/DiagnosticsBundleBuilder.ts apps/cli/test/unit/services/diagnostics/diagnostics-bundle-builder.test.ts
git commit -m "Build shared diagnostics bundles"
```

## Task 8: Export Diagnostics Uses Shared Bundle

**Files:**

- Modify: existing export diagnostics flow in `apps/cli/src/app-shell/workflows.ts` or related diagnostics export module.
- Test: existing export diagnostics test or create `apps/cli/test/unit/services/diagnostics/export-diagnostics.test.ts`

- [ ] **Step 1: Write failing export tests**

Test that `/export-diagnostics` writes the shared bundle, redacts URL secrets, preserves host/path shape, and includes provider timeline.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/export-diagnostics.test.ts
```

- [ ] **Step 3: Wire export to builder**

Replace ad-hoc export payload with `buildDiagnosticsBundle`.

- [ ] **Step 4: Add retention cleanup**

Keep latest 10 diagnostics files when writing to the default diagnostics directory.

- [ ] **Step 5: Run tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/export-diagnostics.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/workflows.ts apps/cli/test/unit/services/diagnostics/export-diagnostics.test.ts
git commit -m "Export shared redacted diagnostics bundles"
```

## Task 9: Report Issue Flow

**Files:**

- Modify: `apps/cli/src/app-shell/workflows.ts`
- Create: `apps/cli/src/services/diagnostics/IssueReportBuilder.ts`
- Test: `apps/cli/test/unit/services/diagnostics/issue-report-builder.test.ts`
- Test: `apps/cli/test/unit/app-shell/report-issue-flow.test.ts` if shell workflow tests exist.

- [ ] **Step 1: Write failing issue report builder tests**

Test markdown contains:

- Category.
- Kunai version.
- Reproduction command when known.
- provider attempt timeline.
- failure classes.
- safe URL summaries.
- no raw token/header/cookie values.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/issue-report-builder.test.ts
```

- [ ] **Step 3: Implement markdown builder**

Export:

```ts
export type IssueReportCategory =
  | "provider-failed"
  | "subtitle-issue"
  | "download-offline"
  | "playback-mpv"
  | "ui-display";

export function buildIssueReportMarkdown(input: {
  readonly category: IssueReportCategory;
  readonly bundle: DiagnosticsBundle;
  readonly reproductionCommand?: string;
}): string;
```

- [ ] **Step 4: Add guided `/report-issue` picker flow**

Flow:

```text
/report-issue
  -> choose category
  -> choose recent problem/timeline if multiple exist
  -> preview markdown
  -> Copy report text
  -> Open GitHub issue
  -> Export diagnostics JSON
  -> Back
```

If clipboard helper is unavailable, show the report text in a preview panel and write only after explicit export.

- [ ] **Step 5: Run tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/issue-report-builder.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/services/diagnostics/IssueReportBuilder.ts apps/cli/src/app-shell/workflows.ts apps/cli/test/unit/services/diagnostics/issue-report-builder.test.ts
git commit -m "Add guided issue report builder"
```

## Task 10: Developer Debug Tracing

**Files:**

- Create: `apps/cli/src/services/diagnostics/DebugTraceReporter.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: config/runtime args types.
- Test: `apps/cli/test/unit/services/diagnostics/debug-trace-reporter.test.ts`
- Test: `apps/cli/test/unit/main-args.test.ts`

- [ ] **Step 1: Write failing debug tests**

Test:

- `--debug-json` parses.
- `KUNAI_TRACE=provider,cache,mpv` scopes categories.
- JSONL reporter writes one event per line without buffering full file.
- Human debug reporter skips categories outside scope.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/debug-trace-reporter.test.ts apps/cli/test/unit/main-args.test.ts
```

- [ ] **Step 3: Implement reporter**

Use `appendFile` or a write stream and never keep all trace events in memory. Reporter consumes already-redacted events.

- [ ] **Step 4: Wire CLI flags and env**

Add:

```text
--debug-json
KUNAI_TRACE=provider,cache,mpv,subtitle,download,offline,search
```

- [ ] **Step 5: Run tests**

```bash
bun test apps/cli/test/unit/services/diagnostics/debug-trace-reporter.test.ts apps/cli/test/unit/main-args.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/services/diagnostics/DebugTraceReporter.ts apps/cli/src/main.ts apps/cli/test/unit/services/diagnostics/debug-trace-reporter.test.ts apps/cli/test/unit/main-args.test.ts
git commit -m "Add structured debug trace reporter"
```

## Task 11: Documentation And Manual Smoke

**Files:**

- Modify: `.docs/diagnostics-guide.md`
- Modify: `README.md`
- Modify: `.plans/roadmap.md`

- [ ] **Step 1: Document user diagnostics**

Add examples for:

```bash
kunai --debug
kunai --debug-json
KUNAI_TRACE=provider,cache,mpv kunai --debug-json -S "Dune"
```

Document `/diagnostics`, `/export-diagnostics`, `/report-issue`, URL redaction, path redaction, and retention.

- [ ] **Step 2: Update roadmap**

Add this plan under active/planned tracks and mark diagnostics foundation as planned or in progress.

- [ ] **Step 3: Run verification**

```bash
bun run typecheck
bun run test
bun run release:dry-run
```

Expected:

- Typecheck passes.
- Test suite passes.
- Release dry-run passes with zero CLI lint warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add .docs/diagnostics-guide.md README.md .plans/roadmap.md
git commit -m "Document provider diagnostics workflow"
```

## Final Verification

Run:

```bash
bun run typecheck
bun run test
bun run release:dry-run
```

Manual smoke:

```bash
bun run dev -- -S "Dune" --debug
bun run dev -- -S "Dune" --debug-json
KUNAI_TRACE=provider,cache bun run dev -- -S "Dune" --debug-json
```

Manual UX checks:

- Force or simulate primary provider timeout.
- Confirm loading shows fallback progress, not final error.
- Confirm fallback success shows recovered notice.
- Confirm final failure shows all attempts and next actions.
- Run `/diagnostics` and confirm provider timeline is visible.
- Run `/export-diagnostics` and inspect redacted URL/path summaries.
- Run `/report-issue`, preview markdown, and confirm no file is written until export/open/copy action.

## Self-Review Checklist

- Every provider failure path has a failure class.
- Every fallback transition is visible in timeline and diagnostics.
- No diagnostics array grows unbounded.
- Redaction preserves host/path shape but removes secrets.
- `/diagnostics`, `/export-diagnostics`, and `/report-issue` share `DiagnosticsBundleBuilder`.
- `--debug-json` streams JSONL and does not buffer full trace files in memory.
- Provider UI copy distinguishes recovering, recovered, and final failure.
