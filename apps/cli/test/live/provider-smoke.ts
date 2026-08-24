import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamInfo, TitleInfo } from "@/domain/types";
import type { StreamRequest } from "@/services/providers/Provider";
import { providerResolveResultToStreamInfo } from "@/services/providers/provider-result-adapter";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import {
  ProviderResolveFailureError,
  resolveProviderCatalogIdentity,
  summarizeProviderTraceEvents,
  type CoreProviderManifest,
  type ProviderTraceEventSummary,
} from "@kunai/core";
import { getKunaiPaths, type StoragePlatform } from "@kunai/storage";
import type { ProviderResolveResult, StartupPriority } from "@kunai/types";

import { storageRootEnv } from "../helpers/storage-env";

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

function hostStoragePlatform(): StoragePlatform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return "linux";
}

export function createProviderSmokeProfile(label: string): ProviderSmokeProfile {
  const rootDir = mkdtempSync(join(tmpdir(), `kunai-live-${label}-`));
  const env = storageRootEnv(rootDir);
  const paths = getKunaiPaths({
    platform: hostStoragePlatform(),
    homeDir: rootDir,
    env,
  });
  mkdirSync(paths.configDir, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  const profile = {
    rootDir,
    configHome: paths.configDir,
    dataHome: paths.dataDir,
    cacheHome: paths.cacheDir,
  };

  Object.assign(process.env, env);

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
  // Summarise the trace on success too. It used to be attached only by
  // `providerSmokeError`, so a resolve that worked reported one total duration
  // and nothing about where the time went -- exactly backwards, since the
  // latency worth attributing lives in successful resolves. On failure
  // `providerSmokeError` is spread after this and still wins.
  const traceSummary = summarizeProviderTraceEvents(stream?.providerResolveResult?.trace.events);
  return {
    ok: Boolean(stream?.url),
    traceEventCount: traceSummary.eventCount,
    lastTraceEvent: traceSummary.lastEvent,
    sourceAttempts: traceSummary.sourceAttempts,
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
      getManifest(providerId: string): CoreProviderManifest | undefined;
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

  // Select title identity exactly the way production does, so a smoke pass
  // cannot come from an identity shortcut the real app never takes.
  const manifest = container.engine.getManifest(providerId);
  if (!manifest) {
    throw new Error(`Missing provider manifest: ${providerId}`);
  }

  const startedAt = Date.now();
  const result = await container.engine.resolve(
    streamRequestToResolveInput(
      request,
      mode,
      "play",
      resolveProviderCatalogIdentity(manifest),
      providerId,
    ),
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
