import type { DiagnosticEvent } from "./diagnostic-event";
import { redactDiagnosticValue } from "./redaction";

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
  readonly runtime: {
    readonly platform: string;
    readonly arch: string;
    readonly bunVersion: string;
  };
  readonly capabilities: Record<string, unknown>;
  readonly correlation: DiagnosticsBundleCorrelation;
  readonly sections: Record<string, DiagnosticsBundleSection>;
  readonly eventCount: number;
  readonly events: readonly DiagnosticEvent[];
};

export type DiagnosticsBundleCorrelation = {
  readonly sessionIds: readonly string[];
  readonly playbackCycleIds: readonly string[];
  readonly providerAttemptIds: readonly string[];
  readonly traceIds: readonly string[];
};

export type DiagnosticsBundleSection = {
  readonly tone: "neutral" | "warning" | "issue";
  readonly eventCount: number;
  readonly latestMessage?: string;
};

export type BuildDiagnosticsSupportBundleInput = {
  readonly appVersion: string;
  readonly debug: boolean;
  readonly capabilities?: Record<string, unknown> | null;
  readonly events: readonly DiagnosticEvent[];
  readonly now?: () => Date;
};

export function buildDiagnosticsSupportBundle(
  input: BuildDiagnosticsSupportBundleInput,
): DiagnosticsSupportBundle {
  const now = input.now ?? (() => new Date());
  const redactionOptions = { homeDir: process.env.HOME };
  const events = redactDiagnosticValue(input.events, redactionOptions) as DiagnosticEvent[];
  const capabilities = redactDiagnosticValue(input.capabilities ?? {}, redactionOptions) as Record<
    string,
    unknown
  >;
  const sections = buildBundleSections(events);

  return {
    exportedAt: now().toISOString(),
    app: {
      version: input.appVersion,
      debug: input.debug,
    },
    summary: {
      headline: buildBundleHeadline(events),
      sections: Object.keys(sections),
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      bunVersion: Bun.version,
    },
    capabilities,
    correlation: buildBundleCorrelation(events),
    sections,
    eventCount: events.length,
    events,
  };
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

function buildBundleHeadline(events: readonly DiagnosticEvent[]): string {
  const issue = [...events]
    .reverse()
    .find((event) => event.level === "error" || event.level === "warn");
  if (issue) return issue.message;
  const latest = events.at(-1);
  return latest?.message ?? "No diagnostic events recorded.";
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
    "offline",
    "download",
    "runtime",
  ];
  const sections: Record<string, DiagnosticsBundleSection> = {};
  for (const name of sectionNames) {
    const matching = events.filter((event) => event.category === name);
    if (matching.length === 0) continue;
    sections[name] = {
      tone: matching.some((event) => event.level === "error")
        ? "issue"
        : matching.some((event) => event.level === "warn")
          ? "warning"
          : "neutral",
      eventCount: matching.length,
      latestMessage: matching.at(-1)?.message,
    };
  }
  return sections;
}
