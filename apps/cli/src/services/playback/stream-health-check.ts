export {
  runStreamHealthCheck as checkStreamHealthDetailed,
  shouldAbortPlaybackForPreflight,
  STREAM_HEALTH_DEFAULTS,
  type StreamHealthPhase,
  type StreamReachabilityFetch as StreamHealthFetch,
  type StreamReachabilityProbeResult as StreamPreflightResult,
} from "@kunai/providers";

import type { StreamInfo } from "@/domain/types";
import {
  isStremioAddonProviderId,
  runStreamHealthCheck,
  STREAM_HEALTH_DEFAULTS,
  type StreamReachabilityFetch,
  type StreamReachabilityProbeResult,
} from "@kunai/providers";

/**
 * True when the stream came from a user-added Stremio addon provider. Infra
 * callers use this instead of re-deriving the provider-id prefix so the strict
 * direct-media rules apply at exactly one decision point.
 */
export function isStremioPlayback(stream: Pick<StreamInfo, "providerResolveResult">): boolean {
  return isStremioAddonProviderId(stream.providerResolveResult?.providerId ?? "");
}

/** Last-chance playback handoff check. Lenient on timeout so mpv can still try. */
export async function checkStreamPreflight(
  url: string,
  headers?: Record<string, string>,
  timeoutMs: number = STREAM_HEALTH_DEFAULTS.preflightTimeoutMs,
  options: {
    readonly cachedAt?: number | null;
    readonly streamReachabilityVerified?: boolean;
    readonly requiresYtdl?: boolean;
    /** Strict addon media proof: playlists, redirects and unverified bodies fail. */
    readonly requireDirectMedia?: boolean;
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
    requireDirectMedia: options.requireDirectMedia,
    timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
  return result.probe ?? { status: "reachable" };
}

/**
 * Strict preflight for a Stremio addon stream: a fresh guarded request that
 * only passes on positive direct-media evidence — no playlists, redirects or
 * attestation shortcuts, since a resolve-gate pass covers the URL it probed,
 * not this moment's media answer.
 */
export async function checkStremioPlaybackPreflight(
  stream: { readonly url: string; readonly headers?: Record<string, string> },
  signal?: AbortSignal,
): Promise<StreamReachabilityProbeResult> {
  const result = await runStreamHealthCheck({
    phase: "playback-preflight",
    url: stream.url,
    headers: stream.headers,
    requireDirectMedia: true,
    signal,
  });
  return result.probe ?? { status: "reachable" };
}
