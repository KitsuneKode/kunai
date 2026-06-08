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
  type StreamHealthPhase,
  type StreamReachabilityFetch,
  type StreamReachabilityProbeResult,
} from "@kunai/providers";

export type StreamHealthCheckInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamReachabilityFetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly cachedAt?: number | null;
  readonly streamReachabilityVerified?: boolean;
};

/** Last-chance playback handoff check. Lenient on timeout so mpv can still try. */
export async function checkStreamPreflight(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = STREAM_HEALTH_DEFAULTS.preflightTimeoutMs,
  options: {
    readonly cachedAt?: number | null;
    readonly streamReachabilityVerified?: boolean;
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
    timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
  return result.probe ?? { status: "reachable" };
}

/** Strict resolve/cache validation for a stream URL. */
export async function checkStreamHealth(
  input: StreamHealthCheckInput & {
    readonly phase?: Extract<StreamHealthPhase, "resolve-gate" | "cache-revalidate">;
    readonly force?: boolean;
  },
): Promise<boolean> {
  const phase =
    input.phase ??
    (input.cachedAt !== undefined && input.cachedAt !== null ? "cache-revalidate" : "resolve-gate");
  const result = await runStreamHealthCheck({
    phase,
    url: input.url,
    headers: input.headers,
    cachedAt: input.cachedAt,
    streamReachabilityVerified: input.streamReachabilityVerified,
    force: input.force,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  return result.healthy;
}
