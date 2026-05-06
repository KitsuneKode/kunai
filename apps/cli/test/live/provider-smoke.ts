import type { StreamInfo, TitleInfo } from "@/domain/types";

export type ProviderSmokePayload = {
  readonly ok: boolean;
  readonly provider: string;
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
  readonly runtime: string | null;
  readonly cacheHit: boolean | null;
  readonly failureCodes: readonly string[];
  readonly error?: string;
};

export function buildProviderSmokePayload({
  provider,
  title,
  season,
  episode,
  stream,
}: {
  readonly provider: string;
  readonly title: TitleInfo;
  readonly season?: number;
  readonly episode?: number;
  readonly stream: StreamInfo | null;
}): ProviderSmokePayload {
  return {
    ok: Boolean(stream?.url),
    provider,
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
    runtime: stream?.providerResolveResult?.trace.runtime ?? null,
    cacheHit: stream?.providerResolveResult?.trace.cacheHit ?? null,
    failureCodes: stream?.providerResolveResult?.failures.map((failure) => failure.code) ?? [],
  };
}

export function providerSmokeError(
  error: unknown,
): Pick<ProviderSmokePayload, "error" | "failureCodes"> {
  const failure =
    error &&
    typeof error === "object" &&
    "failure" in error &&
    error.failure &&
    typeof error.failure === "object"
      ? (error.failure as { code?: unknown })
      : null;

  return {
    error: error instanceof Error ? error.message : String(error),
    failureCodes: typeof failure?.code === "string" ? [failure.code] : [],
  };
}
