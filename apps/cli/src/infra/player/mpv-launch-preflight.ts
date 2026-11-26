import type { StreamInfo } from "@/domain/types";
import {
  checkStreamPreflight,
  type StreamPreflightResult,
} from "@/services/playback/stream-health-check";

import { needsMpvNetworkPreflight, type MpvUrlKind } from "./mpv-playback-url";

/** When a stream was resolved, and whether the resolve gate (`verifyCandidateStream`) probed it. */
export type ResolveGateStream = Pick<StreamInfo, "timestamp" | "providerResolveResult">;

/**
 * The lenient probe one-shot mpv runs while it opens a URL. Addon streams
 * already passed the strict pre-spawn check and local files need none.
 *
 * The resolve gate's evidence earns the same trust the persistent session
 * gives it: a URL verified moments earlier is not probed again as mpv opens
 * it (a second request, and a race for single-use CDN tokens); past the trust
 * window it is probed as before.
 */
export function launchPreflight(opts: {
  readonly url: string;
  readonly urlKind?: MpvUrlKind;
  readonly headers: Record<string, string>;
  readonly requiresYtdl?: boolean;
  readonly stremioAddon?: boolean;
  readonly resolveGate?: ResolveGateStream;
}): Promise<StreamPreflightResult> {
  if (opts.stremioAddon || !needsMpvNetworkPreflight(opts.url, opts.urlKind)) {
    return Promise.resolve({ status: "reachable" });
  }
  return checkStreamPreflight(opts.url, opts.headers, 3_000, {
    cachedAt: opts.resolveGate?.timestamp,
    streamReachabilityVerified: opts.resolveGate?.providerResolveResult?.streamReachabilityVerified,
    requiresYtdl: opts.requiresYtdl,
  });
}
