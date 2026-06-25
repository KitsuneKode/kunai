import { YOUTUBE_METADATA_TTL_MS } from "@/container/configure-youtube-provider";
import type { StreamInfo } from "@/domain/types";
import {
  isYoutubeWatchUrl,
  runStreamHealthCheck,
  type StreamHealthPhase,
  type StreamHealthPolicyReason,
  type StreamHealthSkipReason,
  type StreamHealthStrategy,
  type StreamReachabilityFetch,
} from "@kunai/providers";

export type StreamHealthFetch = StreamReachabilityFetch;

export type StreamHealthServiceDeps = {
  readonly fetchImpl?: StreamHealthFetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly staleAfterMs?: number;
  readonly playbackTrustMs?: number;
};

export type StreamHealthServiceResult = {
  readonly healthy: boolean;
  readonly checked: boolean;
  readonly strategy: StreamHealthStrategy;
  readonly reason: StreamHealthPolicyReason;
  readonly skipReason?: StreamHealthSkipReason;
  readonly ageMs?: number;
};

export class StreamHealthService {
  constructor(private readonly deps: StreamHealthServiceDeps = {}) {}

  async check(
    stream: Pick<
      StreamInfo,
      "url" | "headers" | "timestamp" | "providerResolveResult" | "requiresYtdl"
    >,
    options: {
      readonly force?: boolean;
      readonly signal?: AbortSignal;
      readonly phase?: StreamHealthPhase;
    } = {},
  ): Promise<StreamHealthServiceResult> {
    const phase = options.phase ?? "cache-revalidate";
    const result = await runStreamHealthCheck({
      phase,
      url: stream.url,
      headers: stream.headers,
      cachedAt: stream.timestamp,
      streamReachabilityVerified: stream.providerResolveResult?.streamReachabilityVerified,
      requiresYtdl: stream.requiresYtdl,
      force: options.force,
      fetchImpl: this.deps.fetchImpl,
      timeoutMs: this.deps.timeoutMs,
      signal: options.signal,
      now: this.deps.now?.(),
      staleAfterMs:
        stream.requiresYtdl || isYoutubeWatchUrl(stream.url)
          ? YOUTUBE_METADATA_TTL_MS
          : this.deps.staleAfterMs,
      playbackTrustMs: this.deps.playbackTrustMs,
    });

    return {
      healthy: result.healthy,
      checked: result.probed,
      strategy: result.strategy,
      reason: result.policyReason,
      skipReason: result.skipReason,
      ageMs: result.ageMs,
    };
  }
}
