import {
  episodeFromHistorySelection,
  recordLocalHistorySourceDecision,
} from "@/app/bootstrap/launch-entry";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import type { Container } from "@/container";
import { resolveProviderLaneFromMetadata } from "@/domain/provider-lane";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { historyContentType } from "@/services/continuation/history-progress";

import type { RootHistorySelection } from "./root-history-bridge";

export type HistorySelectionLaunch = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

export type HistoryLaunchReason = "continue" | "history";

/**
 * Turn a history-overlay selection into a playback launch.
 *
 * Shared because the history overlay is reachable by two routes — the palette
 * route, which awaits the selection, and a direct `OPEN_OVERLAY` from inside
 * another overlay. Both have to align the session's provider lane and record the
 * local-vs-stream decision identically, so this cannot be duplicated: a copy
 * that drifted would leave one route playing through the wrong provider.
 *
 * Returns null when the selection cannot be launched (offline asset that no
 * longer resolves).
 */
export async function resolveHistorySelectionLaunch(
  container: Container,
  selection: RootHistorySelection,
  reason: HistoryLaunchReason,
): Promise<HistorySelectionLaunch | null> {
  const { stateManager } = container;

  if (selection.localJobId) {
    const result = await requestUnifiedOfflinePlayback(container, selection.localJobId);
    if (!result) return null;
    return {
      title: result.launch.title,
      ...(result.launch.episode ? { episode: result.launch.episode } : {}),
    };
  }

  const providerMetadata = container.providerRegistry.get(selection.entry.providerId ?? "unknown");
  if (providerMetadata) {
    const lane = resolveProviderLaneFromMetadata(providerMetadata.metadata);
    stateManager.dispatch({
      type: "SET_MODE",
      mode: lane,
      provider: providerMetadata.metadata.id,
    });
  } else {
    stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: selection.entry.providerId ?? "unknown",
    });
  }

  await recordLocalHistorySourceDecision(container, selection, reason);

  const episode = episodeFromHistorySelection(selection);
  return {
    title: {
      id: selection.titleId,
      type: historyContentType(selection.entry),
      name: selection.entry.title,
      launchSource: reason === "history" ? "history" : "continue",
    },
    ...(episode ? { episode } : {}),
  };
}
