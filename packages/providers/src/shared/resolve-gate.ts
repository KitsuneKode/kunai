import type { ProviderRuntimeContext, StreamCandidate } from "@kunai/types";

import { runStreamHealthCheck, STREAM_HEALTH_DEFAULTS } from "./stream-health";
import {
  isStreamReachableForResolve,
  type StreamReachabilityProbeResult,
} from "./stream-reachability";

/**
 * The one way a provider proves a candidate is playable before reporting success.
 *
 * **It takes the candidate, not a URL plus separately-assembled headers.** That
 * is the whole point. Videasy verified a stream with `Origin: vidking.net` and
 * shipped the same URL with `Origin: cineby.at`; the CDN accepted the first and
 * refused the second, so the gate attested a request shape production never
 * made and cycling stopped at a source that could not play. Passing the
 * candidate makes the probed shape and the shipped shape the same object.
 *
 * Only a *definitive* refusal rejects. A timeout, a non-definitive error, or a
 * skipped probe is not evidence of a dead stream — treating it as one trades a
 * working source for a slow link, and playback preflight still runs before mpv
 * receives the handoff.
 */
export type CandidateStreamVerdict =
  | { readonly accepted: true; readonly verified: boolean }
  | {
      readonly accepted: false;
      readonly reason: string;
      readonly probe?: StreamReachabilityProbeResult;
    };

export async function verifyCandidateStream({
  stream,
  context,
  signal,
  timeoutMs = STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs,
}: {
  readonly stream: Pick<StreamCandidate, "url" | "headers">;
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<CandidateStreamVerdict> {
  const url = stream.url?.trim();
  if (!url) return { accepted: false, reason: "candidate has no stream url" };

  const health = await runStreamHealthCheck({
    phase: "resolve-gate",
    url,
    // The candidate's own headers, verbatim — never a re-derived set.
    headers: stream.headers,
    fetchImpl: context.fetch?.fetch.bind(context.fetch),
    timeoutMs,
    signal: signal ?? context.signal,
  });

  const probe = health.probe;
  if (!probe || isStreamReachableForResolve(probe)) {
    return { accepted: true, verified: probe?.status === "reachable" };
  }

  return {
    accepted: false,
    reason: probe.status === "unreachable" ? probe.reason : `stream probe ${probe.status}`,
    probe,
  };
}

export type VerifiedStreamSelection<TStream> =
  | { readonly accepted: true; readonly stream: TStream; readonly verified: boolean }
  | { readonly accepted: false; readonly reason: string };

/**
 * The first stream of a source that actually verifies.
 *
 * A refusal is evidence about *that stream*, not about the source: a candidate
 * often carries several qualities, and they do not always sit on the same host.
 * Rejecting the whole source on the first refusal throws away rungs that would
 * have played, so the walk continues and the source is refused only when every
 * distinct host has refused.
 *
 * One probe per host, because a host answers the same for every rung it serves
 * — the extra probes would cost latency inside the candidate's budget and tell
 * us nothing new.
 */
export async function selectVerifiedStream<
  TStream extends Pick<StreamCandidate, "url" | "headers">,
>({
  streams,
  context,
  signal,
  timeoutMs,
}: {
  readonly streams: readonly TStream[];
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<VerifiedStreamSelection<TStream>> {
  let firstReason: string | undefined;
  const refusedHosts = new Set<string>();

  for (const stream of streams) {
    const host = streamHost(stream.url);
    if (host && refusedHosts.has(host)) continue;

    const verdict = await verifyCandidateStream({
      stream,
      context,
      ...(signal === undefined ? {} : { signal }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (verdict.accepted) return { accepted: true, stream, verified: verdict.verified };

    firstReason ??= verdict.reason;
    if (host) refusedHosts.add(host);
  }

  return { accepted: false, reason: firstReason ?? "candidate has no stream url" };
}

function streamHost(url: string | undefined): string {
  try {
    return new URL(url ?? "").host.toLowerCase();
  } catch {
    return "";
  }
}
