import type { ProviderRuntimeContext, StreamCandidate } from "@kunai/types";

import { isStreamRefused, selectVerifiedStream } from "../shared/resolve-gate";

export type RivestreamFinalGateSelection =
  | {
      readonly accepted: true;
      readonly stream: StreamCandidate;
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
 * stream is still eligible unless the walk just gathered URL or host evidence
 * against it.
 */
export async function selectRivestreamFinalStream({
  selected,
  selectableStreams,
  candidateGateStream,
  context,
  signal,
  timeoutMs,
  maxProbes,
}: {
  readonly selected: StreamCandidate;
  readonly selectableStreams: readonly StreamCandidate[];
  readonly candidateGateStream: StreamCandidate;
  readonly context: ProviderRuntimeContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxProbes: number;
}): Promise<RivestreamFinalGateSelection> {
  const gateOrder = [
    selected,
    ...selectableStreams.filter((stream) => stream.id !== selected.id),
  ].slice(0, maxProbes);
  const gated = await selectVerifiedStream({
    streams: gateOrder,
    context,
    ...(signal === undefined ? null : { signal }),
    ...(timeoutMs === undefined ? null : { timeoutMs }),
  });
  if (gated.accepted) return gated;

  const fallback = selectableStreams.find((stream) => stream.id === candidateGateStream.id);
  if (fallback && !isStreamRefused(fallback, gated.refusals)) {
    return { accepted: true, stream: fallback, refusals: gated.refusals };
  }
  return gated;
}
