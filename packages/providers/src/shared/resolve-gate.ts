import type { ProviderRuntimeContext, StreamCandidate } from "@kunai/types";

import { runStreamHealthCheck, STREAM_HEALTH_DEFAULTS } from "./stream-health";
import {
  isStreamReachableForResolve,
  type StreamReachabilityProbeResult,
} from "./stream-reachability";

/** Room left for the candidate's own work after its gate probes. */
const RESOLVE_GATE_CANDIDATE_HEADROOM_MS = 500;

/**
 * `runStreamHealthCheck` probes a second time when the first attempt reached no
 * verdict, so a candidate has to be able to afford two of them.
 */
const RESOLVE_GATE_MAX_PROBES = 2;

/**
 * The gate budget a candidate can actually afford.
 *
 * A provider's chosen candidate timeout is not what it gets:
 * `providerCycleCandidateTimeoutMs` caps it at a fraction of the attempt
 * budget, and on `fast` that lands at 4.8s — below the shared 6s gate. Sizing a
 * gate against the provider's *unclamped* number means the candidate aborts the
 * probe on the fastest profile, the probe reports `timeout`, and the gate is let
 * through: coverage that quietly stops working exactly where latency matters
 * most.
 *
 * Always pass the clamped value.
 */
export function resolveGateBudgetMs(
  candidateTimeoutMs: number,
  preferredMs: number = STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs,
): number {
  const affordable = Math.floor(
    (candidateTimeoutMs - RESOLVE_GATE_CANDIDATE_HEADROOM_MS) / RESOLVE_GATE_MAX_PROBES,
  );
  return Math.max(1, Math.min(preferredMs, affordable));
}

export type CandidateStreamVerdict =
  | { readonly accepted: true; readonly verified: boolean }
  | {
      readonly accepted: false;
      readonly reason: string;
      readonly probe?: StreamReachabilityProbeResult;
    };

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
    resolvesLocally: context.fetch?.resolvesLocally,
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
  | {
      readonly accepted: true;
      readonly stream: TStream;
      readonly verified: boolean;
      /**
       * Hosts proven dead during the walk. The caller must drop their streams:
       * leaving a refused rung in the inventory lets selection ship the very
       * stream the gate rejected.
       */
      readonly refusedHosts: ReadonlySet<string>;
    }
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
  hedgeDelayMs,
}: {
  readonly streams: readonly TStream[];
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly hedgeDelayMs?: number;
}): Promise<VerifiedStreamSelection<TStream>> {
  let firstReason: string | undefined;
  const refusedHosts = new Set<string>();

  // If hedging is not requested or there's only 1 stream, keep the simple sequential walk.
  if (!hedgeDelayMs || hedgeDelayMs <= 0 || streams.length <= 1) {
    for (const stream of streams) {
      const host = streamHost(stream.url);
      if (host && refusedHosts.has(host)) continue;

      const verdict = await verifyCandidateStream({
        stream,
        context,
        ...(signal === undefined ? null : { signal }),
        ...(timeoutMs === undefined ? null : { timeoutMs }),
      });
      if (verdict.accepted) {
        return { accepted: true, stream, verified: verdict.verified, refusedHosts };
      }

      firstReason ??= verdict.reason;
      if (host) refusedHosts.add(host);
    }

    return { accepted: false, reason: firstReason ?? "candidate has no stream url" };
  }

  let streamIndex = 0;
  const parentSignal = signal ?? context.signal;

  while (streamIndex < streams.length) {
    if (parentSignal?.aborted) {
      break;
    }
    const stream = streams[streamIndex];
    if (!stream) {
      streamIndex++;
      continue;
    }
    const host = streamHost(stream.url);
    if (host && refusedHosts.has(host)) {
      streamIndex++;
      continue;
    }

    // Find next eligible stream on a distinct host to hedge
    let nextStream: TStream | undefined;
    let nextStreamIndex = -1;
    for (let j = streamIndex + 1; j < streams.length; j++) {
      const candidateStream = streams[j];
      if (!candidateStream) continue;
      const candidateHost = streamHost(candidateStream.url);
      if (!candidateHost || (candidateHost !== host && !refusedHosts.has(candidateHost))) {
        nextStream = candidateStream;
        nextStreamIndex = j;
        break;
      }
    }

    // Derive practical hedge delay from timeout budget: if timeoutMs is too tight
    // (e.g. <= hedgeDelayMs + 300ms), hedging won't finish before gate cutoff, so skip it.
    const effectiveHedgeDelayMs = timeoutMs && timeoutMs <= hedgeDelayMs + 300 ? 0 : hedgeDelayMs;

    const currentAbort = new AbortController();
    const nextAbort = new AbortController();
    const onAbort = () => {
      currentAbort.abort(parentSignal?.reason);
      nextAbort.abort(parentSignal?.reason);
    };
    parentSignal?.addEventListener("abort", onAbort, { once: true });

    const probeStream = (s: TStream, sig: AbortSignal) =>
      verifyCandidateStream({
        stream: s,
        context,
        signal: sig,
        ...(timeoutMs === undefined ? null : { timeoutMs }),
      });

    type RacedProbeResult =
      | { readonly which: "primary"; readonly verdict: CandidateStreamVerdict }
      | { readonly which: "backup"; readonly verdict: CandidateStreamVerdict };

    const primaryPromise: Promise<RacedProbeResult> = probeStream(stream, currentAbort.signal).then(
      (verdict) => ({ which: "primary", verdict }),
      (err) => ({ which: "primary", verdict: { accepted: false, reason: String(err) } }),
    );

    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let backupPromise: Promise<RacedProbeResult> | undefined;

    if (nextStream && effectiveHedgeDelayMs > 0) {
      const hedgedStream = nextStream;
      const nextSig = nextAbort.signal;
      backupPromise = new Promise<RacedProbeResult>((resolve) => {
        hedgeTimer = setTimeout(() => {
          hedgeTimer = undefined;
          if (currentAbort.signal.aborted || parentSignal?.aborted) {
            resolve({ which: "backup", verdict: { accepted: false, reason: "cancelled" } });
            return;
          }
          probeStream(hedgedStream, nextSig).then(
            (verdict) => resolve({ which: "backup", verdict }),
            (err) =>
              resolve({ which: "backup", verdict: { accepted: false, reason: String(err) } }),
          );
        }, effectiveHedgeDelayMs);
      });
    }

    try {
      if (!nextStream || !backupPromise) {
        const { verdict } = await primaryPromise;
        if (parentSignal?.aborted) break;
        if (verdict.accepted) {
          return { accepted: true, stream, verified: verdict.verified, refusedHosts };
        }
        firstReason ??= verdict.reason;
        if (host) refusedHosts.add(host);
        streamIndex++;
        continue;
      }

      const hedgedStream = nextStream;

      // Race primary against the scheduled/running backup probe
      const firstResult = await Promise.race([primaryPromise, backupPromise]);

      if (firstResult.which === "primary") {
        if (firstResult.verdict.accepted) {
          nextAbort.abort();
          return { accepted: true, stream, verified: firstResult.verdict.verified, refusedHosts };
        }
        firstReason ??= firstResult.verdict.reason;
        if (host) refusedHosts.add(host);

        // Primary rejected; wait for the backup if it was already launched
        if (hedgeTimer) {
          clearTimeout(hedgeTimer);
          hedgeTimer = undefined;
          nextAbort.abort();
          streamIndex++;
          continue;
        }

        const backupResult = await backupPromise;
        if (parentSignal?.aborted) break;
        const nextHost = streamHost(hedgedStream.url);
        if (backupResult.verdict.accepted) {
          return {
            accepted: true,
            stream: hedgedStream,
            verified: backupResult.verdict.verified,
            refusedHosts,
          };
        }
        firstReason ??= backupResult.verdict.reason;
        if (nextHost) refusedHosts.add(nextHost);
        streamIndex = nextStreamIndex + 1;
        continue;
      } else {
        // Backup finished first! To abort the primary early, backup MUST have verified: true
        // (a definitive reachable probe), avoiding soft accepts/timeouts from killing a viable primary.
        if (firstResult.verdict.accepted && firstResult.verdict.verified) {
          currentAbort.abort();
          primaryPromise.catch(() => undefined);
          if (parentSignal?.aborted) break;
          return {
            accepted: true,
            stream: hedgedStream,
            verified: true,
            refusedHosts,
          };
        }
        // Backup failed or only soft-accepted; wait for primary to settle definitively
        const primaryResult = await primaryPromise;
        if (parentSignal?.aborted) break;
        if (primaryResult.verdict.accepted) {
          return { accepted: true, stream, verified: primaryResult.verdict.verified, refusedHosts };
        }
        firstReason ??= primaryResult.verdict.reason;
        if (host) refusedHosts.add(host);
        const nextHost = streamHost(hedgedStream.url);
        if (firstResult.verdict.accepted) {
          // Primary failed and backup was soft-accepted, so ship backup now
          return {
            accepted: true,
            stream: hedgedStream,
            verified: firstResult.verdict.verified,
            refusedHosts,
          };
        }
        if (nextHost) refusedHosts.add(nextHost);
        streamIndex = nextStreamIndex + 1;
        continue;
      }
    } finally {
      if (hedgeTimer) clearTimeout(hedgeTimer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  }

  return { accepted: false, reason: firstReason ?? "candidate has no stream url" };
}

/**
 * Drop the streams whose host the gate proved dead.
 *
 * The walk refuses a host, not a rung, so the caller cannot just remove the one
 * stream that failed — every rung on that host is equally gone. Leaving them in
 * lets startup selection ship the exact stream the gate rejected, which is
 * usually the highest quality and therefore the one it prefers.
 */
export function dropRefusedStreams<TStream extends Pick<StreamCandidate, "url">>(
  streams: readonly TStream[],
  refusedHosts: ReadonlySet<string>,
): TStream[] {
  if (refusedHosts.size === 0) return [...streams];
  return streams.filter((stream) => !refusedHosts.has(streamHost(stream.url)));
}

export function streamHost(url: string | undefined): string {
  try {
    return new URL(url ?? "").host.toLowerCase();
  } catch {
    return "";
  }
}
