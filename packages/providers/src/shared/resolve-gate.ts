import type { ProviderRuntimeContext, StreamCandidate } from "@kunai/types";

import { runStreamHealthCheck, STREAM_HEALTH_DEFAULTS } from "./stream-health";
import {
  isStreamReachableForResolve,
  streamUrlHost,
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
 * Only a *definitive* refusal rejects — **in the default lenient mode**. A
 * timeout, a non-definitive error, or a skipped probe is not evidence of a
 * dead stream — treating it as one trades a working source for a slow link,
 * and playback preflight still runs before mpv receives the handoff.
 * `requireDirectMedia` is the exception: there only positive direct-media
 * evidence accepts, because inconclusive answers are exactly what a rotating
 * or challenged addon endpoint looks like.
 */
export async function verifyCandidateStream({
  stream,
  context,
  signal,
  timeoutMs = STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs,
  requireDirectMedia,
}: {
  readonly stream: Pick<StreamCandidate, "url" | "headers">;
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Strict addon media proof: only positive direct-media evidence verifies. */
  readonly requireDirectMedia?: boolean;
}): Promise<CandidateStreamVerdict> {
  const url = stream.url?.trim();
  if (!url) return { accepted: false, reason: "candidate has no stream url" };

  const health = await runStreamHealthCheck({
    phase: "resolve-gate",
    url,
    // The candidate's own headers, verbatim — never a re-derived set.
    headers: stream.headers,
    // Probe the way the player will resolve: `probeFetch` uses system DNS even
    // when metadata goes through DoH, so the probed and played requests agree.
    fetchImpl: (context.fetch?.probeFetch ?? context.fetch?.fetch)?.bind(context.fetch),
    resolvesLocally: context.fetch?.resolvesLocally,
    requireDirectMedia,
    timeoutMs,
    signal: signal ?? context.signal,
  });

  const probe = health.probe;
  if (probe?.status === "reachable") return { accepted: true, verified: true };
  if (!requireDirectMedia && (!probe || isStreamReachableForResolve(probe))) {
    return { accepted: true, verified: false };
  }
  return {
    accepted: false,
    reason:
      probe?.status === "unreachable" ? probe.reason : `stream probe ${probe?.status ?? "skipped"}`,
    ...(probe ? { probe } : null),
  };
}

export type VerifiedStreamSelection<TStream> =
  | {
      readonly accepted: true;
      readonly stream: TStream;
      readonly verified: boolean;
      /**
       * URL or host evidence gathered before the accepted stream. The caller
       * must drop matching rungs: leaving one in inventory lets selection ship
       * the exact stream the gate rejected.
       */
      readonly refusals: ReadonlySet<string>;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
      /** Present on failure too, so a caller can tell whether prior proof is still usable. */
      readonly refusals: ReadonlySet<string>;
    };

/**
 * The first stream of a source that actually verifies.
 *
 * HTTP, manifest, and media refusals are evidence about the exact URL: one HLS
 * rung can 404 while its sibling on the same CDN host plays. Transport and
 * target-guard refusals are evidence about the host and skip only that host's
 * later URLs. This keeps the walk bounded by the caller's input slice or
 * candidate timer without repeating probes that cannot reach a different
 * answer.
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
  const refusals = new Set<string>();

  for (const stream of streams) {
    if (isStreamRefused(stream, refusals)) continue;

    const verdict = await verifyCandidateStream({
      stream,
      context,
      ...(signal === undefined ? null : { signal }),
      ...(timeoutMs === undefined ? null : { timeoutMs }),
    });
    if (verdict.accepted) {
      return { accepted: true, stream, verified: verdict.verified, refusals };
    }

    firstReason ??= verdict.reason;
    const probe = verdict.probe?.status === "unreachable" ? verdict.probe : undefined;
    if (probe?.refusalScope === "host") {
      // A playlist can fail on an absolute variant or segment host different
      // from the stream's own host. That evidence suppresses the host that
      // actually failed, while the stream URL itself is refused without
      // indicting healthy sibling URLs on the playlist's host.
      const originalHost = streamUrlHost(stream.url);
      const refusedHost = probe.refusalHost || originalHost;
      if (refusedHost) refusals.add(hostRefusalKey(refusedHost));
      else refusals.add(urlRefusalKey(stream.url, stream.headers));
      if (originalHost && refusedHost !== originalHost) {
        refusals.add(urlRefusalKey(stream.url, stream.headers));
      }
    } else {
      refusals.add(urlRefusalKey(stream.url, stream.headers));
    }
  }

  return {
    accepted: false,
    reason: firstReason ?? "candidate has no stream url",
    refusals,
  };
}

export type ProbedFinalStreamSelection<TStream> =
  | {
      readonly accepted: true;
      readonly stream: TStream;
      readonly refusals: ReadonlySet<string>;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
      readonly refusals: ReadonlySet<string>;
    };

/**
 * Probe the stream startup selection will ship, then fall back to the stream
 * that already passed the candidate gate.
 *
 * The bounded walk is intentionally small so a dead high-quality ladder cannot
 * consume the whole resolve. That bound must not throw away the lower-ranked
 * proof that let this candidate survive cycling: when the walk exhausts, that
 * exact object is still eligible unless the walk just gathered URL or host
 * evidence against it. Object identity is deliberate — a duplicate URL with
 * different playback headers is a different request.
 */
export async function selectProbedFinalStream<
  TStream extends Pick<StreamCandidate, "url" | "headers">,
>({
  selected,
  selectableStreams,
  candidateGateStream,
  context,
  signal,
  timeoutMs,
  maxProbes,
}: {
  readonly selected: TStream;
  readonly selectableStreams: readonly TStream[];
  readonly candidateGateStream: TStream;
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxProbes: number;
}): Promise<ProbedFinalStreamSelection<TStream>> {
  const gateOrder = [selected, ...selectableStreams.filter((stream) => stream !== selected)].slice(
    0,
    maxProbes,
  );
  const gated = await selectVerifiedStream({ streams: gateOrder, context, signal, timeoutMs });
  if (gated.accepted) return gated;

  if (
    selectableStreams.includes(candidateGateStream) &&
    !isStreamRefused(candidateGateStream, gated.refusals)
  ) {
    return { accepted: true, stream: candidateGateStream, refusals: gated.refusals };
  }
  return gated;
}

/** Whether prior gate evidence already refuses this exact URL or its host. */
export function isStreamRefused<
  TStream extends Pick<StreamCandidate, "url"> & Partial<Pick<StreamCandidate, "headers">>,
>(stream: TStream, refusals: ReadonlySet<string>): boolean {
  if (refusals.has(urlRefusalKey(stream.url, stream.headers))) return true;
  const host = streamUrlHost(stream.url);
  return host.length > 0 && refusals.has(hostRefusalKey(host));
}

/**
 * Drop the streams the gate proved dead, whether the evidence was the exact
 * URL (an HTTP/media refusal) or the whole host (a transport/guard refusal).
 */
export function dropRefusedStreams<
  TStream extends Pick<StreamCandidate, "url"> & Partial<Pick<StreamCandidate, "headers">>,
>(streams: readonly TStream[], refusals: ReadonlySet<string>): TStream[] {
  if (refusals.size === 0) return [...streams];
  return streams.filter((stream) => !isStreamRefused(stream, refusals));
}

function urlRefusalKey(url: string | undefined, headers?: Record<string, string>): string {
  const requestHeaders = Object.entries(headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return `url:${url ?? ""}:${JSON.stringify(requestHeaders)}`;
}

function hostRefusalKey(host: string): string {
  return `host:${host}`;
}
