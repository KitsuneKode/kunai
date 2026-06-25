import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamInfo, TitleInfo } from "@/domain/types";
import type { StreamRequest } from "@/services/providers/Provider";
import { providerResolveResultToStreamInfo } from "@/services/providers/provider-result-adapter";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import {
  ProviderResolveFailureError,
  summarizeProviderTraceEvents,
  type ProviderTraceEventSummary,
} from "@kunai/core";
import type { ProviderResolveResult, StartupPriority } from "@kunai/types";

export type ProviderSmokePayload = {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly provider: string;
  readonly providerId: string;
  readonly title: string;
  readonly titleId: string;
  readonly type: TitleInfo["type"];
  readonly season?: number;
  readonly episode?: number;
  readonly streamResolved: boolean;
  readonly streamHost: string | null;
  readonly subtitleTracks: number;
  readonly selectedSubtitleUrl: string | null;
  readonly headerKeys: readonly string[];
  readonly engine: string | null;
  readonly runtime: string | null;
  readonly resolveDurationMs: number | null;
  readonly cacheHit: boolean | null;
  readonly failureCodes: readonly string[];
  readonly failureMessages?: readonly string[];
  readonly streamCandidates?: number;
  readonly traceEventCount?: number;
  readonly lastTraceEvent?: ProviderTraceEventSummary | null;
  readonly sourceAttempts?: readonly ProviderTraceEventSummary[];
  readonly startupPriority?: StartupPriority;
  readonly isolatedProfile?: boolean;
  readonly profileRoot?: string;
  readonly error?: string;
};

export type ProviderSmokeProfile = {
  readonly rootDir: string;
  readonly configHome: string;
  readonly dataHome: string;
  readonly cacheHome: string;
};

export function createProviderSmokeProfile(label: string): ProviderSmokeProfile {
  const rootDir = mkdtempSync(join(tmpdir(), `kunai-live-${label}-`));
  const profile = {
    rootDir,
    configHome: join(rootDir, "config"),
    dataHome: join(rootDir, "data"),
    cacheHome: join(rootDir, "cache"),
  };

  process.env.XDG_CONFIG_HOME = profile.configHome;
  process.env.XDG_DATA_HOME = profile.dataHome;
  process.env.XDG_CACHE_HOME = profile.cacheHome;

  process.on("exit", () => {
    rmSync(rootDir, { force: true, recursive: true });
  });

  return profile;
}

export function providerSmokeProfilePayload(
  profile: ProviderSmokeProfile,
): Pick<ProviderSmokePayload, "isolatedProfile" | "profileRoot"> {
  return {
    isolatedProfile: true,
    profileRoot: profile.rootDir,
  };
}

export function buildProviderSmokePayload({
  provider,
  title,
  season,
  episode,
  stream,
  resolveDurationMs,
}: {
  readonly provider: string;
  readonly title: TitleInfo;
  readonly season?: number;
  readonly episode?: number;
  readonly stream: StreamInfo | null;
  readonly resolveDurationMs?: number | null;
}): ProviderSmokePayload {
  const engine = stream?.providerResolveResult?.trace.runtime ?? null;
  return {
    ok: Boolean(stream?.url),
    skipped: false,
    provider,
    providerId: provider,
    title: title.name,
    titleId: title.id,
    type: title.type,
    season,
    episode,
    streamResolved: Boolean(stream?.url),
    streamHost: stream?.url ? new URL(stream.url).host : null,
    subtitleTracks: stream?.subtitleList?.length ?? 0,
    selectedSubtitleUrl: stream?.subtitle ?? null,
    headerKeys: Object.keys(stream?.headers ?? {}),
    engine,
    runtime: engine,
    resolveDurationMs: resolveDurationMs ?? null,
    cacheHit: stream?.providerResolveResult?.trace.cacheHit ?? null,
    failureCodes: stream?.providerResolveResult?.failures.map((failure) => failure.code) ?? [],
  };
}

export async function resolveProviderSmokeStream({
  container,
  providerId,
  request,
  mode,
}: {
  readonly container: {
    readonly engine: {
      get(providerId: string): unknown;
      resolve(
        input: ReturnType<typeof streamRequestToResolveInput>,
        providerId: string,
      ): Promise<ProviderResolveResult>;
    };
  };
  readonly providerId: string;
  readonly request: StreamRequest;
  readonly mode: "series" | "anime" | "youtube";
}): Promise<{
  readonly stream: StreamInfo | null;
  readonly result: ProviderResolveResult;
  readonly resolveDurationMs: number;
}> {
  if (!container.engine.get(providerId)) {
    throw new Error(`Missing provider module: ${providerId}`);
  }

  const startedAt = Date.now();
  const result = await container.engine.resolve(
    streamRequestToResolveInput(request, mode),
    providerId,
  );
  return {
    result,
    resolveDurationMs: Date.now() - startedAt,
    stream: providerResolveResultToStreamInfo({
      result,
      title: request.title.name,
      subtitlePreference: request.subtitlePreference,
    }),
  };
}

export function providerSmokeError(
  error: unknown,
): Pick<
  ProviderSmokePayload,
  | "error"
  | "failureCodes"
  | "failureMessages"
  | "streamCandidates"
  | "traceEventCount"
  | "lastTraceEvent"
  | "sourceAttempts"
> {
  const result = error instanceof ProviderResolveFailureError ? error.result : null;
  const failure = error instanceof ProviderResolveFailureError ? error.failure : null;
  const traceSummary = summarizeProviderTraceEvents(result?.trace.events);

  return {
    error: error instanceof Error ? error.message : String(error),
    failureCodes: result?.failures.map((item) => item.code) ?? (failure ? [failure.code] : []),
    failureMessages:
      result?.failures.map((item) => item.message) ?? (failure ? [failure.message] : []),
    streamCandidates: result?.streams.length ?? 0,
    traceEventCount: traceSummary.eventCount,
    lastTraceEvent: traceSummary.lastEvent,
    sourceAttempts: traceSummary.sourceAttempts,
  };
}
