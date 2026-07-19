import type { PlaybackSourceInventoryDiagnosticsSummary } from "../playback/PlaybackSourceInventoryProjection";
import type { ResolveWorkLedgerSnapshot } from "../playback/ResolveWorkLedger";
import {
  redactBundleValue,
  resolveBundleRedactionOptions,
  type BundleRedactionOptions,
} from "./bundle-redaction";
import type { DiagnosticEvent } from "./diagnostic-event";
import {
  mapFailureToRecommendedAction,
  type DiagnosticFailureClass,
} from "./diagnostic-event-helpers";
import type { DiagnosticsInsight, RecommendedAction } from "./diagnostics-insight";
import { getDiagnosticOperation } from "./operation-taxonomy";
import { redactDiagnosticValue } from "./redaction";
import {
  buildResolveWorkDiagnosticsInsight,
  type ResolveWorkDiagnosticsInsight,
} from "./resolve-work-insight";

/** Default support-bundle size budget (256 KiB). Oldest events drop first. */
export const DEFAULT_SUPPORT_BUNDLE_MAX_BYTES = 256 * 1024;

export type DiagnosticsBundleTriage = {
  readonly verdict: string;
  readonly likelyCause: string;
  readonly affectedSubsystems: readonly string[];
  readonly recommendedActions: readonly RecommendedAction[];
  readonly correlationSummary: string;
  readonly lastEventBySubsystem: Record<string, string>;
  readonly privacy: {
    readonly redacted: true;
    readonly excludes: readonly string[];
  };
};

export type DiagnosticsBundleEnvironment = {
  readonly mpvVersion?: string | null;
  readonly terminal?: string | null;
  readonly enabledProviders?: readonly string[];
  readonly schemaVersions?: {
    readonly data: readonly string[];
    readonly cache: readonly string[];
  };
  readonly runtimeHealth?: Record<string, unknown> | null;
};

export type DiagnosticsBundleTruncation = {
  readonly truncated: true;
  readonly maxBytes: number;
  readonly droppedOldestEventCount: number;
  readonly note: string;
};

export type DiagnosticsSupportBundle = {
  readonly exportedAt: string;
  readonly app: {
    readonly version: string;
    readonly debug: boolean;
  };
  readonly summary: {
    readonly headline: string;
    readonly sections: readonly string[];
  };
  readonly triage: DiagnosticsBundleTriage;
  readonly runtime: {
    readonly platform: string;
    readonly arch: string;
    readonly bunVersion: string;
    readonly mpvVersion?: string | null;
    readonly terminal?: string | null;
  };
  readonly environment: DiagnosticsBundleEnvironment;
  readonly privacy: {
    readonly redacted: true;
    readonly excludes: readonly string[];
  };
  readonly capabilities: Record<string, unknown>;
  readonly playbackSourceInventory?: PlaybackSourceInventoryDiagnosticsSummary;
  readonly insights: DiagnosticsBundleInsights;
  readonly correlation: DiagnosticsBundleCorrelation;
  readonly sections: Record<string, DiagnosticsBundleSection>;
  readonly eventCount: number;
  readonly events: readonly DiagnosticEvent[];
  readonly truncation?: DiagnosticsBundleTruncation;
};

export type DiagnosticsBundleCorrelation = {
  readonly sessionIds: readonly string[];
  readonly playbackCycleIds: readonly string[];
  readonly providerAttemptIds: readonly string[];
  readonly traceIds: readonly string[];
};

export type DiagnosticsBundleInsights = {
  readonly continuationDecision?: DiagnosticsEventInsight;
  readonly providerResolve?: DiagnosticsEventInsight;
  readonly resolveWork?: ResolveWorkDiagnosticsInsight;
  readonly sourceInventoryCache?: DiagnosticsEventInsight;
  readonly postPlayback?: DiagnosticsEventInsight;
  readonly downloadRepair?: DiagnosticsEventInsight;
  readonly offlineContinuity?: DiagnosticsEventInsight;
};

export type DiagnosticsEventInsight = {
  readonly eventCount: number;
  readonly latestMessage?: string;
  readonly latestOperation?: string;
  readonly context?: Record<string, unknown>;
};

export type DiagnosticsBundleSection = {
  readonly tone: "neutral" | "warning" | "issue";
  readonly eventCount: number;
  readonly latestOperation?: string;
  readonly latestOperationSummary?: string;
  readonly latestUserAction?: string;
  readonly latestMessage?: string;
};

export type BuildDiagnosticsSupportBundleInput = {
  readonly appVersion: string;
  readonly debug: boolean;
  readonly capabilities?: Record<string, unknown> | null;
  readonly playbackSourceInventory?: PlaybackSourceInventoryDiagnosticsSummary | null;
  readonly resolveWorkLedgers?: readonly ResolveWorkLedgerSnapshot[] | null;
  readonly events: readonly DiagnosticEvent[];
  readonly insight?: DiagnosticsInsight | null;
  readonly environment?: DiagnosticsBundleEnvironment | null;
  readonly maxBytes?: number;
  readonly redaction?: BundleRedactionOptions;
  readonly now?: () => Date;
};

export function buildDiagnosticsSupportBundle(
  input: BuildDiagnosticsSupportBundleInput,
): DiagnosticsSupportBundle {
  const now = input.now ?? (() => new Date());
  const redactionOptions = input.redaction ?? resolveBundleRedactionOptions();
  const legacyOptions = { homeDir: redactionOptions.homeDir };
  const events = redactBundleValue(
    redactDiagnosticValue(input.events, legacyOptions),
    redactionOptions,
  ) as DiagnosticEvent[];
  const capabilities = redactBundleValue(
    redactDiagnosticValue(input.capabilities ?? {}, legacyOptions),
    redactionOptions,
  ) as Record<string, unknown>;
  const playbackSourceInventory = input.playbackSourceInventory
    ? (redactBundleValue(
        redactDiagnosticValue(input.playbackSourceInventory, legacyOptions),
        redactionOptions,
      ) as PlaybackSourceInventoryDiagnosticsSummary)
    : undefined;
  const sections = buildBundleSections(events);
  const triage = buildBundleTriage(events, input.insight);
  const environment = redactBundleValue(
    {
      mpvVersion: input.environment?.mpvVersion ?? null,
      terminal: input.environment?.terminal ?? null,
      enabledProviders: input.environment?.enabledProviders ?? [],
      schemaVersions: input.environment?.schemaVersions ?? { data: [], cache: [] },
      runtimeHealth: input.environment?.runtimeHealth ?? null,
    } satisfies DiagnosticsBundleEnvironment,
    redactionOptions,
  ) as DiagnosticsBundleEnvironment;

  const bundle: DiagnosticsSupportBundle = {
    exportedAt: now().toISOString(),
    app: {
      version: input.appVersion,
      debug: input.debug,
    },
    summary: {
      headline: triage.likelyCause,
      sections: Object.keys(sections),
    },
    triage,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      bunVersion: Bun.version,
      mpvVersion: environment.mpvVersion ?? null,
      terminal: environment.terminal ?? null,
    },
    environment,
    privacy: {
      redacted: true,
      excludes: [
        "stream URLs",
        "subtitle URLs",
        "headers",
        "tokens",
        "local paths",
        "history rows",
        "titles",
        "search queries",
        "usernames",
      ],
    },
    capabilities,
    playbackSourceInventory,
    insights: buildBundleInsights(events, input.resolveWorkLedgers ?? undefined),
    correlation: buildBundleCorrelation(events),
    sections,
    eventCount: events.length,
    events,
  };

  return applySupportBundleSizeBudget(bundle, input.maxBytes ?? DEFAULT_SUPPORT_BUNDLE_MAX_BYTES);
}

/**
 * Cap serialized bundle size by dropping oldest diagnostic events.
 * Records truncation metadata in the file when events are removed.
 */
export function applySupportBundleSizeBudget(
  bundle: DiagnosticsSupportBundle,
  maxBytes: number = DEFAULT_SUPPORT_BUNDLE_MAX_BYTES,
): DiagnosticsSupportBundle {
  if (maxBytes <= 0) return bundle;
  let events = [...bundle.events];
  let dropped = 0;
  let candidate: DiagnosticsSupportBundle = {
    ...bundle,
    eventCount: events.length,
    events,
  };

  while (utf8ByteLength(JSON.stringify(candidate)) > maxBytes && events.length > 0) {
    events = events.slice(1);
    dropped += 1;
    const eventInsights = buildBundleInsights(events, undefined);
    candidate = {
      ...bundle,
      eventCount: events.length,
      events,
      sections: buildBundleSections(events),
      correlation: buildBundleCorrelation(events),
      insights: {
        ...eventInsights,
        // Ledger insight is independent of the event window; keep it under budget.
        resolveWork: bundle.insights.resolveWork,
      },
      truncation: {
        truncated: true,
        maxBytes,
        droppedOldestEventCount: dropped,
        note: `Bundle exceeded ${maxBytes} bytes; dropped ${dropped} oldest diagnostic event${dropped === 1 ? "" : "s"}.`,
      },
    };
  }

  if (utf8ByteLength(JSON.stringify(candidate)) > maxBytes) {
    return {
      ...candidate,
      truncation: {
        truncated: true,
        maxBytes,
        droppedOldestEventCount: dropped,
        note:
          dropped > 0
            ? `Bundle exceeded ${maxBytes} bytes after dropping ${dropped} oldest diagnostic event${dropped === 1 ? "" : "s"}; non-event payload alone remains oversized.`
            : `Bundle exceeded ${maxBytes} bytes; non-event payload alone is oversized.`,
      },
    };
  }

  return candidate;
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function buildBundleInsights(
  events: readonly DiagnosticEvent[],
  resolveWorkLedgers?: readonly ResolveWorkLedgerSnapshot[],
): DiagnosticsBundleInsights {
  const insights: {
    continuationDecision?: DiagnosticsEventInsight;
    providerResolve?: DiagnosticsEventInsight;
    resolveWork?: ResolveWorkDiagnosticsInsight;
    sourceInventoryCache?: DiagnosticsEventInsight;
    postPlayback?: DiagnosticsEventInsight;
    downloadRepair?: DiagnosticsEventInsight;
    offlineContinuity?: DiagnosticsEventInsight;
  } = {};
  const continuationDecision = buildOperationInsight(events, [
    "continuation.project",
    "continuation.source",
  ]);
  if (continuationDecision) insights.continuationDecision = continuationDecision;
  const providerResolve = buildOperationPrefixInsight(events, "provider.resolve.");
  if (providerResolve) insights.providerResolve = providerResolve;
  const resolveWork = buildResolveWorkDiagnosticsInsight(resolveWorkLedgers);
  if (resolveWork) insights.resolveWork = resolveWork;
  const sourceInventoryCache = buildOperationPrefixInsight(events, "source-inventory.cache.");
  if (sourceInventoryCache) insights.sourceInventoryCache = sourceInventoryCache;
  const postPlayback = buildOperationPrefixInsight(events, "post-playback.");
  if (postPlayback) insights.postPlayback = postPlayback;
  const downloadRepair = buildOperationPrefixInsight(events, "download.artifact.repairable");
  if (downloadRepair) insights.downloadRepair = downloadRepair;
  const offlineContinuity = buildOperationInsight(events, [
    "download.capacity.start",
    "offline-runway.evaluate",
    "offline-maintenance.process",
  ]);
  if (offlineContinuity) insights.offlineContinuity = offlineContinuity;
  return insights;
}

function buildOperationPrefixInsight(
  events: readonly DiagnosticEvent[],
  operationPrefix: string,
): DiagnosticsEventInsight | undefined {
  const matching = events.filter((event) => event.operation.startsWith(operationPrefix));
  if (matching.length === 0) return undefined;
  const latest = matching.at(-1);
  const insight: DiagnosticsEventInsight = {
    eventCount: matching.length,
  };
  const withLatest =
    latest === undefined
      ? insight
      : {
          ...insight,
          latestMessage: latest.message,
          latestOperation: latest.operation,
        };
  if (latest?.context && Object.keys(latest.context).length > 0) {
    return {
      ...withLatest,
      context: redactDiagnosticValue(latest.context) as Record<string, unknown>,
    };
  }
  return withLatest;
}

function buildOperationInsight(
  events: readonly DiagnosticEvent[],
  operations: readonly string[],
): DiagnosticsEventInsight | undefined {
  const allowed = new Set(operations);
  const matching = events.filter((event) => allowed.has(event.operation));
  if (matching.length === 0) return undefined;
  const latest = matching.at(-1);
  const insight: DiagnosticsEventInsight = {
    eventCount: matching.length,
    latestMessage: latest?.message,
    latestOperation: latest?.operation,
  };
  return latest?.context
    ? { ...insight, context: redactDiagnosticValue(latest.context) as Record<string, unknown> }
    : insight;
}

function buildBundleCorrelation(events: readonly DiagnosticEvent[]): DiagnosticsBundleCorrelation {
  return {
    sessionIds: collectUnique(events, "sessionId"),
    playbackCycleIds: collectUnique(events, "playbackCycleId"),
    providerAttemptIds: collectUnique(events, "providerAttemptId"),
    traceIds: collectUnique(events, "traceId"),
  };
}

function collectUnique(
  events: readonly DiagnosticEvent[],
  key: "sessionId" | "playbackCycleId" | "providerAttemptId" | "traceId",
): readonly string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const value = event[key];
    if (typeof value === "string" && value.length > 0) {
      ids.add(value);
    }
  }
  return [...ids];
}

function buildBundleTriage(
  events: readonly DiagnosticEvent[],
  providedInsight?: DiagnosticsInsight | null,
): DiagnosticsBundleTriage {
  const lastEventBySubsystem: Record<string, string> = {};
  for (const name of [
    "network",
    "provider",
    "cache",
    "playback",
    "subtitle",
    "presence",
    "download",
    "runtime",
  ]) {
    const latest = [...events].reverse().find((event) => event.category === name);
    if (latest) {
      lastEventBySubsystem[name] = latest.message;
    }
  }

  if (!providedInsight) {
    const eventOnly = buildEventOnlyTriage(events);
    return {
      ...eventOnly,
      lastEventBySubsystem,
      privacy: {
        redacted: true,
        excludes: ["stream URLs", "subtitle URLs", "headers", "tokens", "local paths"],
      },
    };
  }

  return {
    verdict: providedInsight.exportSummary.verdict,
    likelyCause:
      providedInsight.likelyCause === "No issues detected in recent diagnostics"
        ? (buildBundleHeadline(events) ?? providedInsight.likelyCause)
        : providedInsight.likelyCause,
    affectedSubsystems: providedInsight.exportSummary.affectedSubsystems,
    recommendedActions: providedInsight.exportSummary.recommendedActions,
    correlationSummary: providedInsight.exportSummary.correlationSummary,
    lastEventBySubsystem,
    privacy: {
      redacted: true,
      excludes: ["stream URLs", "subtitle URLs", "headers", "tokens", "local paths"],
    },
  };
}

function buildEventOnlyTriage(
  events: readonly DiagnosticEvent[],
): Omit<DiagnosticsBundleTriage, "lastEventBySubsystem" | "privacy"> {
  const issueEvents = events.filter((event) => event.level === "error" || event.level === "warn");
  const affectedSubsystems = collectAffectedSubsystems(issueEvents);
  const recommendedActions = collectRecommendedActions(issueEvents);
  return {
    verdict: issueEvents.some((event) => event.level === "error")
      ? "Broken"
      : issueEvents.length > 0
        ? "Needs attention"
        : "Healthy",
    likelyCause: buildBundleHeadline(events),
    affectedSubsystems,
    recommendedActions: recommendedActions.length > 0 ? recommendedActions : ["none"],
    correlationSummary: formatBundleCorrelationSummary(buildBundleCorrelation(events)),
  };
}

function collectAffectedSubsystems(events: readonly DiagnosticEvent[]): readonly string[] {
  const subsystems = new Set<string>();
  for (const event of events) {
    subsystems.add(event.category);
  }
  return [...subsystems];
}

function collectRecommendedActions(
  events: readonly DiagnosticEvent[],
): readonly RecommendedAction[] {
  const actions = new Set<RecommendedAction>();
  for (const event of events) {
    const action = parseRecommendedAction(event.context?.recommendedAction);
    if (action && action !== "none") actions.add(action);
    const failureClass =
      typeof event.context?.failureClass === "string" ? event.context.failureClass : null;
    if (isDiagnosticFailureClass(failureClass)) {
      actions.add(mapFailureToRecommendedAction(failureClass));
    }
  }
  return [...actions];
}

function isDiagnosticFailureClass(value: string | null): value is DiagnosticFailureClass {
  return (
    value === "timeout" ||
    value === "http" ||
    value === "parse" ||
    value === "dependency" ||
    value === "not-found" ||
    value === "rate-limited" ||
    value === "cancelled" ||
    value === "storage" ||
    value === "ipc" ||
    value === "unknown"
  );
}

function parseRecommendedAction(value: unknown): RecommendedAction | null {
  if (
    value === "none" ||
    value === "wait" ||
    value === "recover" ||
    value === "fallback-provider" ||
    value === "refresh-source" ||
    value === "retry" ||
    value === "retry-download" ||
    value === "check-dependency" ||
    value === "open-settings" ||
    value === "export-diagnostics" ||
    value === "report-issue"
  ) {
    return value;
  }
  return null;
}

function formatBundleCorrelationSummary(correlation: DiagnosticsBundleCorrelation): string {
  const parts = [
    correlation.sessionIds.length > 0 ? `session ${correlation.sessionIds[0]}` : null,
    correlation.playbackCycleIds.length > 0 ? `cycle ${correlation.playbackCycleIds[0]}` : null,
    correlation.providerAttemptIds.length > 0
      ? `provider ${correlation.providerAttemptIds[0]}`
      : null,
    correlation.traceIds.length > 0 ? `trace ${correlation.traceIds[0]}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("  ·  ") : "no correlation ids";
}

function buildBundleHeadline(events: readonly DiagnosticEvent[]): string {
  const issue =
    [...events].reverse().find((event) => event.level === "error") ??
    [...events].reverse().find((event) => event.level === "warn");
  if (issue) return formatIssueHeadline(issue);
  const latest = events.at(-1);
  return latest?.message ?? "No diagnostic events recorded.";
}

function formatIssueHeadline(event: DiagnosticEvent): string {
  if (event.operation === "provider.resolve.timeline") {
    const provider = event.providerId ?? "provider";
    const failureClass =
      typeof event.context?.failureClass === "string" ? event.context.failureClass : null;
    if (failureClass && failureClass !== "none") {
      return `${provider} ${failureClass.replaceAll("-", " ")}`;
    }
  }
  return event.message;
}

function buildBundleSections(
  events: readonly DiagnosticEvent[],
): Record<string, DiagnosticsBundleSection> {
  const sectionNames = [
    "network",
    "provider",
    "cache",
    "playback",
    "subtitle",
    "presence",
    "offline",
    "download",
    "runtime",
  ];
  const sections: Record<string, DiagnosticsBundleSection> = {};
  for (const name of sectionNames) {
    const matching = events.filter((event) => event.category === name);
    if (matching.length === 0) continue;
    const latest = matching.at(-1);
    const operation = latest ? getDiagnosticOperation(latest.operation) : undefined;
    sections[name] = {
      tone: matching.some((event) => event.level === "error")
        ? "issue"
        : matching.some((event) => event.level === "warn")
          ? "warning"
          : "neutral",
      eventCount: matching.length,
      latestOperation: latest?.operation,
      latestOperationSummary: operation?.summary,
      latestUserAction: operation?.userAction,
      latestMessage: latest?.message,
    };
  }
  return sections;
}
