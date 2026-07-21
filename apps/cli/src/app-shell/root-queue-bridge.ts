/**
 * Bridge between the `{ type: "queue" }` overlay (rendered by root-overlay-shell)
 * and the workflow that opened it. Reorder / remove / clear / restore happen
 * inside the overlay against `QueueService` directly; only `play` (start the
 * selected entry) leaves the overlay and resolves this bridge. Mirrors
 * root-history-bridge.ts.
 *
 * Manual play claims the exact row via `beginPlayback` before handoff — presence
 * of a later-attached `queuePlaybackIntent` is not itself a claim.
 */

import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
import type { QueueService } from "@/domain/queue/QueueService";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

export interface QueuePlaybackLaunch {
  readonly intent: QueuePlaybackIntent;
  readonly title: string;
}

/** @deprecated Prefer QueuePlaybackLaunch — kept as the bridge promise value alias. */
export type RootQueueSelection = QueuePlaybackLaunch;

type QueueResolver = (value: QueuePlaybackLaunch | null) => void;

let pendingResolver: QueueResolver | null = null;

export function waitForRootQueueSelection(): Promise<QueuePlaybackLaunch | null> {
  return new Promise<QueuePlaybackLaunch | null>((resolve) => {
    pendingResolver = resolve;
  });
}

export function resolveRootQueueSelection(value: QueuePlaybackLaunch | null): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(value);
}

export function hasPendingRootQueueSelection(): boolean {
  return pendingResolver !== null;
}

type QueueClaimPort = Pick<QueueService, "beginPlayback" | "getAll">;

/**
 * Resolve the exact queue row by ID and claim it for playback handoff.
 * Returns undefined when the row is missing or compare-and-set fails.
 */
export function claimQueuePlaybackLaunch(
  queueService: QueueClaimPort,
  queueEntryId: string,
  source: QueuePlaybackIntent["source"] = "queue",
): QueuePlaybackLaunch | undefined {
  const entry = queueService.getAll().find((candidate) => candidate.id === queueEntryId);
  if (!entry) return undefined;
  const intent = queueService.beginPlayback(queueEntryId, source);
  if (!intent) return undefined;
  return { intent, title: entry.title };
}

/**
 * Enter-on-row play path: claim first; only resolve+close when claim succeeds.
 * Failed CAS leaves the overlay open (caller must not close).
 */
export function resolveQueueRowPlaySelection(
  queueService: QueueClaimPort,
  queueEntryId: string,
  resolve: (value: QueuePlaybackLaunch) => void,
  closeOverlay: () => void,
  source: QueuePlaybackIntent["source"] = "queue",
): "claimed" | "failed" {
  const launch = claimQueuePlaybackLaunch(queueService, queueEntryId, source);
  if (!launch) return "failed";
  resolve(launch);
  closeOverlay();
  return "claimed";
}

export function titleInfoFromQueuePlaybackLaunch(launch: QueuePlaybackLaunch): TitleInfo {
  return {
    id: launch.intent.titleId,
    type: launch.intent.mediaKind === "movie" ? "movie" : "series",
    name: launch.title,
    queuePlaybackIntent: launch.intent,
  };
}

export function episodeInfoFromQueuePlaybackLaunch(
  launch: QueuePlaybackLaunch,
): EpisodeInfo | undefined {
  const { intent } = launch;
  if (intent.mediaKind === "movie") return undefined;
  if (
    intent.season === undefined &&
    intent.episode === undefined &&
    intent.absoluteEpisode === undefined
  ) {
    return undefined;
  }
  return {
    season: intent.season ?? 1,
    episode: intent.episode ?? intent.absoluteEpisode ?? 1,
    absoluteEpisode: intent.absoluteEpisode,
  };
}
