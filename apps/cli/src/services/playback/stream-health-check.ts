export {
  runStreamHealthCheck as checkStreamHealthDetailed,
  shouldAbortPlaybackForPreflight,
  STREAM_HEALTH_DEFAULTS,
  type StreamHealthPhase,
  type StreamReachabilityFetch as StreamHealthFetch,
  type StreamReachabilityProbeResult as StreamPreflightResult,
} from "@kunai/providers";

import {
  runStreamHealthCheck,
  STREAM_HEALTH_DEFAULTS,
  type StreamReachabilityFetch,
  type StreamReachabilityProbeResult,
} from "@kunai/providers";

/** Last-chance playback handoff check. Lenient on timeout so mpv can still try. */
export async function checkStreamPreflight(
  url: string,
  headers?: Record<string, string>,
  timeoutMs: number = STREAM_HEALTH_DEFAULTS.preflightTimeoutMs,
  options: {
    readonly cachedAt?: number | null;
    readonly streamReachabilityVerified?: boolean;
    readonly requiresYtdl?: boolean;
    readonly signal?: AbortSignal;
    readonly fetchImpl?: StreamReachabilityFetch;
  } = {},
): Promise<StreamReachabilityProbeResult> {
  const result = await runStreamHealthCheck({
    phase: "playback-preflight",
    url,
    headers,
    cachedAt: options.cachedAt,
    streamReachabilityVerified: options.streamReachabilityVerified,
    requiresYtdl: options.requiresYtdl,
    timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
  return result.probe ?? { status: "reachable" };
}
