import type { ProviderFailureClass } from "@kunai/types";

export type { ProviderFailureClass };

export type ProviderAttemptReason = "primary" | "retry" | "fallback" | "manual";

export type ProviderTimelineStatus =
  | "idle"
  | "resolving"
  | "recovering"
  | "resolved"
  | "recovered"
  | "failed";

export type ProviderAttemptTimelineEvent =
  | {
      readonly type: "attempt-started";
      readonly traceId?: string;
      readonly attemptId: string;
      readonly providerId: string;
      readonly reason: ProviderAttemptReason;
      readonly at: number;
    }
  | {
      readonly type: "attempt-failed";
      readonly traceId?: string;
      readonly attemptId: string;
      readonly providerId: string;
      readonly at: number;
      readonly failureClass: ProviderFailureClass;
      readonly retryable: boolean;
      readonly userSummary: string;
      readonly developerDetail?: string;
    }
  | {
      readonly type: "fallback-started";
      readonly traceId?: string;
      readonly attemptId: string;
      readonly fromProviderId: string;
      readonly toProviderId: string;
      readonly reason: ProviderFailureClass;
      readonly at: number;
    }
  | {
      readonly type: "attempt-succeeded";
      readonly traceId?: string;
      readonly attemptId: string;
      readonly providerId: string;
      readonly at: number;
      readonly cacheHit?: boolean;
      readonly streamCount?: number;
    }
  | {
      readonly type: "final-failed";
      readonly traceId?: string;
      readonly at: number;
      readonly userSummary: string;
    };

export type ProviderAttemptSnapshot = {
  readonly attemptId: string;
  readonly providerId: string;
  readonly reason: ProviderAttemptReason;
  readonly status: "running" | "failed" | "succeeded";
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly failureClass?: ProviderFailureClass;
  readonly retryable?: boolean;
  readonly userSummary?: string;
  readonly developerDetail?: string;
  readonly cacheHit?: boolean;
  readonly streamCount?: number;
};

export type ProviderAttemptTimelineSnapshot = {
  readonly traceId: string;
  readonly status: ProviderTimelineStatus;
  readonly attempts: readonly ProviderAttemptSnapshot[];
  readonly events: readonly ProviderAttemptTimelineEvent[];
  readonly truncated: boolean;
};

export type ProviderAttemptTimelineSummary = {
  readonly traceId: string;
  readonly status: ProviderTimelineStatus;
  readonly currentUserMessage: string;
  readonly primaryFailure?: string;
  readonly attempts: readonly ProviderAttemptSnapshot[];
};

export type ProviderAttemptTimeline = {
  record(event: ProviderAttemptTimelineEvent): void;
  snapshot(): ProviderAttemptTimelineSnapshot;
};

type ProviderAttemptTimelineOptions = {
  readonly traceId: string;
  readonly maxAttempts?: number;
  readonly maxEvents?: number;
};

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_MAX_EVENTS = 50;

export function createProviderAttemptTimeline(
  options: ProviderAttemptTimelineOptions,
): ProviderAttemptTimeline {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS);
  const attempts = new Map<string, ProviderAttemptSnapshot>();
  const events: ProviderAttemptTimelineEvent[] = [];
  let status: ProviderTimelineStatus = "idle";
  let truncated = false;

  function capAttempts(): void {
    while (attempts.size > maxAttempts) {
      const oldest = attempts.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      attempts.delete(oldest);
      truncated = true;
    }
  }

  function capEvents(): void {
    if (events.length <= maxEvents) {
      return;
    }
    events.splice(0, events.length - maxEvents);
    truncated = true;
  }

  function record(event: ProviderAttemptTimelineEvent): void {
    const withTrace = attachTraceId(options.traceId, event);
    events.push(withTrace);
    capEvents();

    if (event.type === "attempt-started") {
      attempts.set(event.attemptId, {
        attemptId: event.attemptId,
        providerId: event.providerId,
        reason: event.reason,
        status: "running",
        startedAt: event.at,
      });
      status = event.reason === "fallback" ? "recovering" : "resolving";
      capAttempts();
      return;
    }

    if (event.type === "fallback-started") {
      attempts.set(event.attemptId, {
        attemptId: event.attemptId,
        providerId: event.toProviderId,
        reason: "fallback",
        status: "running",
        startedAt: event.at,
      });
      status = "recovering";
      capAttempts();
      return;
    }

    if (event.type === "attempt-failed") {
      const attempt = attempts.get(event.attemptId);
      attempts.set(event.attemptId, {
        attemptId: event.attemptId,
        providerId: event.providerId,
        reason: attempt?.reason ?? "primary",
        status: "failed",
        startedAt: attempt?.startedAt ?? event.at,
        finishedAt: event.at,
        failureClass: event.failureClass,
        retryable: event.retryable,
        userSummary: event.userSummary,
        developerDetail: event.developerDetail,
      });
      status = "failed";
      capAttempts();
      return;
    }

    if (event.type === "attempt-succeeded") {
      const attempt = attempts.get(event.attemptId);
      attempts.set(event.attemptId, {
        attemptId: event.attemptId,
        providerId: event.providerId,
        reason: attempt?.reason ?? "primary",
        status: "succeeded",
        startedAt: attempt?.startedAt ?? event.at,
        finishedAt: event.at,
        cacheHit: event.cacheHit,
        streamCount: event.streamCount,
      });
      status = attempt?.reason === "fallback" ? "recovered" : "resolved";
      capAttempts();
      return;
    }

    status = "failed";
  }

  function snapshot(): ProviderAttemptTimelineSnapshot {
    return {
      traceId: options.traceId,
      status,
      attempts: [...attempts.values()],
      events: [...events],
      truncated,
    };
  }

  return { record, snapshot };
}

export function summarizeProviderAttemptTimeline(
  snapshot: ProviderAttemptTimelineSnapshot,
): ProviderAttemptTimelineSummary {
  const primaryFailure = snapshot.attempts.find(
    (attempt) => attempt.reason === "primary" && attempt.status === "failed",
  )?.userSummary;
  const lastEvent = snapshot.events.at(-1);
  const lastAttempt = snapshot.attempts.at(-1);

  return {
    traceId: snapshot.traceId,
    status: snapshot.status,
    currentUserMessage: summarizeCurrentMessage(snapshot, lastEvent, lastAttempt),
    primaryFailure,
    attempts: snapshot.attempts,
  };
}

function summarizeCurrentMessage(
  snapshot: ProviderAttemptTimelineSnapshot,
  lastEvent: ProviderAttemptTimelineEvent | undefined,
  lastAttempt: ProviderAttemptSnapshot | undefined,
): string {
  if (lastEvent?.type === "final-failed") {
    return lastEvent.userSummary;
  }

  if (snapshot.status === "recovered" && lastAttempt?.status === "succeeded") {
    return `Recovered via ${formatProviderName(lastAttempt.providerId)}`;
  }

  if (snapshot.status === "resolved" && lastAttempt?.status === "succeeded") {
    return `Resolved via ${formatProviderName(lastAttempt.providerId)}`;
  }

  if (lastEvent?.type === "fallback-started") {
    return `${formatProviderName(lastEvent.fromProviderId)} had an issue. Trying ${formatProviderName(
      lastEvent.toProviderId,
    )} fallback now.`;
  }

  if (lastAttempt?.status === "failed" && lastAttempt.userSummary) {
    return lastAttempt.userSummary;
  }

  if (snapshot.status === "recovering") {
    return "Recovering with the next available provider.";
  }

  if (snapshot.status === "resolving") {
    return "Finding a playable stream.";
  }

  if (snapshot.status === "failed") {
    return "Could not find a playable stream.";
  }

  return "Waiting to resolve provider stream.";
}

function attachTraceId(
  traceId: string,
  event: ProviderAttemptTimelineEvent,
): ProviderAttemptTimelineEvent {
  if (event.traceId) {
    return event;
  }
  return { ...event, traceId } as ProviderAttemptTimelineEvent;
}

function formatProviderName(providerId: string): string {
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
