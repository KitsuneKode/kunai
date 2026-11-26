import {
  episodeFromHistorySelection,
  recordLocalHistorySourceDecision,
  titleFromHistorySelection,
} from "@/app/bootstrap/launch-entry";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import type { Container } from "@/container";
import { resolveProviderLaneFromMetadata } from "@/domain/provider-lane";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";
import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";

import { forceCloseRootContent, getRootContentSession } from "./root-content-state";
import {
  hasPendingRootHistorySelection,
  resolveRootHistorySelection,
  type RootHistorySelection,
} from "./root-history-bridge";
import type { BrowseShellResult } from "./types";

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
      ...titleFromHistorySelection(selection),
      launchSource: reason === "history" ? "history" : "continue",
    },
    ...(episode ? { episode } : null),
  };
}

/**
 * What a confirmed History pick does from the History overlay: record the
 * source decision, hand the pick to an awaiting palette route, or launch it
 * from browse. Shared by Enter and by a second tap on the row.
 */
export function confirmHistoryOverlaySelection(
  container: Container,
  selection: RootHistorySelection | null,
  input: {
    readonly preference: ContinueSourcePreference;
    readonly sourceOverride?: "local" | "stream";
    readonly setOverlayStatus: (status: string | null) => void;
  },
): void {
  if (selection) {
    void import("@/services/continuation/continuation-diagnostics").then(
      ({ recordContinuationSourceResolution }) =>
        recordContinuationSourceResolution(container, {
          surface: "history",
          selection,
          preference: input.preference,
          override: input.sourceOverride,
          resolved: selection.localJobId ? "local" : "stream",
        }),
    );
  }
  // Only the palette route awaits this. Opened directly from another overlay
  // there is no resolver, so the selection used to vanish and the overlay
  // simply closed. Fall back to the same launch channel the inbox uses, via the
  // shared resolver so both routes align the provider lane and record the
  // source decision identically.
  const awaited = hasPendingRootHistorySelection();
  resolveRootHistorySelection(selection);
  if (!selection) return;
  // launch-playback resolves only on browse — delivered to a playback or picker
  // session it would be a foreign result the phase loop cannot read, silently
  // dropping the pick.
  if (!awaited && getRootContentSession()?.kind !== "browse") {
    input.setOverlayStatus("Play it from the search screen");
    return;
  }
  container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  if (!awaited) {
    void resolveHistorySelectionLaunch(container, selection, "history").then((launch) =>
      launch
        ? forceCloseRootContent<BrowseShellResult<SearchResult>>({
            type: "launch-playback",
            launch,
          })
        : false,
    );
  }
}
