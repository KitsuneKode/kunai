import type {
  ProviderRuntimeContext,
  ProviderSelectionDecision,
  StreamCandidate,
} from "@kunai/types";

import { selectReadyStream } from "./startup-selection";
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
       * Hosts proven dead during the walk — DNS/TLS/refused-connection
       * verdicts, which apply to every rung the host serves.
       */
      readonly refusedHosts: ReadonlySet<string>;
      /**
       * Requests the gate refused on their own evidence — an HTTP refusal is
       * scoped to the URL and headers that produced it. A signed URL's 403
       * says nothing about a sibling rendition on the same CDN, so the caller
       * drops exactly these requests and no more.
       */
      readonly refusedRequests: ReadonlySet<string>;
    }
  | { readonly accepted: false; readonly reason: string };

/**
 * The first stream of a source that actually verifies.
 *
 * A refusal is evidence about *that stream*, not about the source: a candidate
 * often carries several qualities, and they do not always sit on the same host.
 * Rejecting the whole source on the first refusal throws away rungs that would
 * have played, so the walk continues and the source is refused only when every
 * request has refused.
 *
 * Two refusal scopes, because they are different evidence. A connection-level
 * verdict — DNS, TLS, refused socket, SSRF-block — kills the host, so sibling
 * rungs on it are skipped unprobed. An HTTP refusal is scoped to the request:
 * the same CDN host happily serves the 720p rung whose signature is still
 * valid after refusing the 1080p one, so the walk keys by request shape
 * (URL + headers) and probes each distinct request once.
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
  const refusedRequests = new Set<string>();

  for (const stream of streams) {
    const host = streamHost(stream.url);
    const requestKey = streamRequestKey(stream);
    if ((host && refusedHosts.has(host)) || refusedRequests.has(requestKey)) continue;

    const verdict = await verifyCandidateStream({
      stream,
      context,
      ...(signal === undefined ? null : { signal }),
      ...(timeoutMs === undefined ? null : { timeoutMs }),
    });
    if (verdict.accepted) {
      return { accepted: true, stream, verified: verdict.verified, refusedHosts, refusedRequests };
    }

    firstReason ??= verdict.reason;
    if (verdict.probe?.status === "unreachable" && verdict.probe.hostRefusal) {
      // A host-scoped refusal with no parseable host (e.g. the URL itself is
      // unparseable) still has to refuse *something* — otherwise the walk
      // re-picks the same stream until the deadline burns out.
      if (host) refusedHosts.add(host);
      else refusedRequests.add(requestKey);
    } else {
      refusedRequests.add(requestKey);
    }
  }

  return { accepted: false, reason: firstReason ?? "candidate has no stream url" };
}

export type VerifiedReadySelection =
  | {
      readonly accepted: true;
      readonly selected: StreamCandidate;
      readonly decision: ProviderSelectionDecision;
      readonly verified: boolean;
      /**
       * Inventory minus what the gate proved dead — ship this, not the input
       * list. Refused requests stay out even when they were not the pick.
       */
      readonly streams: StreamCandidate[];
      readonly refusedHosts: ReadonlySet<string>;
      readonly refusedRequests: ReadonlySet<string>;
    }
  | { readonly accepted: false; readonly reason: string };

/**
 * `selectReadyStream` with the resolve gate folded in.
 *
 * Selection order is user preference (explicit pin, favorite source, quality),
 * not array order, so `selectVerifiedStream` cannot express it: probing in
 * array order would attest whichever rung sits first, not the one the picker
 * would ship. This walks the same preference order — pick, probe the pick,
 * and on a definitive refusal drop exactly the refused scope and re-pick —
 * so the stream that reports success is the stream that was probed, and a
 * dead top preference falls through to the next preference tier rather than
 * being shipped anyway.
 *
 * Terminates because every refused pick is removed from `remaining` before
 * the next iteration.
 */
export async function selectVerifiedReadyStream({
  streams,
  input,
  context,
  signal,
  timeoutMs,
  walkBudgetMs,
}: {
  readonly streams: readonly StreamCandidate[];
  readonly input: Parameters<typeof selectReadyStream>[1];
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /**
   * Total budget for the whole walk — not per probe. A candidate's stream list
   * can hold many rungs, and a definitive refusal each is still serial probe
   * time inside one candidate/attempt bound; without a wall the walk can spend
   * the entire attempt proving rungs dead and never give the next candidate
   * its turn. Default: two probes' worth.
   */
  readonly walkBudgetMs?: number;
}): Promise<VerifiedReadySelection> {
  let remaining = [...streams];
  const refusedHosts = new Set<string>();
  const refusedRequests = new Set<string>();
  let firstReason: string | undefined;
  let refusedCount = 0;
  const walkDeadline = Date.now() + (walkBudgetMs ?? ((timeoutMs ?? 0) * 2 || 12_000));

  while (remaining.length > 0) {
    const walkRemainingMs = walkDeadline - Date.now();
    if (walkRemainingMs <= 0) {
      // The evidence so far is only refusals — the un-probed remainder is
      // not an answer, so the candidate fails rather than shipping a pick
      // nobody verified.
      return {
        accepted: false,
        reason:
          firstReason !== undefined
            ? `${firstReason} (walk budget exhausted after ${refusedCount} refusal(s))`
            : "stream gate walk budget exhausted",
      };
    }

    let pick: ReturnType<typeof selectReadyStream>;
    try {
      pick = selectReadyStream(remaining, input);
    } catch {
      break;
    }

    const verdict = await verifyCandidateStream({
      stream: pick.selected,
      context,
      ...(signal === undefined ? null : { signal }),
      timeoutMs: timeoutMs === undefined ? walkRemainingMs : Math.min(timeoutMs, walkRemainingMs),
    });
    if (verdict.accepted) {
      return {
        accepted: true,
        selected: pick.selected,
        decision: pick.decision,
        verified: verdict.verified,
        streams: remaining,
        refusedHosts,
        refusedRequests,
      };
    }

    firstReason ??= verdict.reason;
    refusedCount += 1;
    if (verdict.probe?.status === "unreachable" && verdict.probe.hostRefusal) {
      // Same rule as the single-stream path: a host refusal that produced no
      // host still refuses the request, or the loop re-probes it forever.
      const host = streamHost(pick.selected.url);
      if (host) refusedHosts.add(host);
      else refusedRequests.add(streamRequestKey(pick.selected));
    } else {
      refusedRequests.add(streamRequestKey(pick.selected));
    }
    remaining = dropRefusedStreams(remaining, { refusedHosts, refusedRequests });
  }

  return { accepted: false, reason: firstReason ?? "candidate has no stream url" };
}

/**
 * Drop the streams the gate proved dead — every rung on a refused host, and
 * every individually refused request. Leaving a refused rung in the inventory
 * lets startup selection ship the exact stream the gate rejected, which is
 * usually the highest quality and therefore the one it prefers.
 */
export function dropRefusedStreams<TStream extends Pick<StreamCandidate, "url" | "headers">>(
  streams: readonly TStream[],
  refused: {
    readonly refusedHosts: ReadonlySet<string>;
    readonly refusedRequests: ReadonlySet<string>;
  },
): TStream[] {
  if (refused.refusedHosts.size === 0 && refused.refusedRequests.size === 0) {
    return [...streams];
  }
  return streams.filter(
    (stream) =>
      !refused.refusedHosts.has(streamHost(stream.url)) &&
      !refused.refusedRequests.has(streamRequestKey(stream)),
  );
}

/**
 * The dedupe key is the whole request shape: a candidate's URL *and* headers
 * both decide whether the host serves it, so two streams that differ only in
 * headers are different requests (and get probed separately).
 */
function streamRequestKey(stream: Pick<StreamCandidate, "url" | "headers">): string {
  const headers = stream.headers ?? {};
  const ordered = Object.keys(headers)
    .sort()
    .map((name) => `${name.toLowerCase()}:${headers[name] ?? ""}`)
    .join("\n");
  return `${stream.url ?? ""}\n${ordered}`;
}

function streamHost(url: string | undefined): string {
  try {
    return new URL(url ?? "").host.toLowerCase();
  } catch {
    return "";
  }
}
