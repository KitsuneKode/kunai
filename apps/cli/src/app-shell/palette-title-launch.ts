// =============================================================================
// palette-title-launch.ts — what happens when Enter lands on a JUMP TO row.
//
// Two halves:
//
//   resolvePaletteTitleLaunch — LocalTitleEntry → { title, episode? }, reusing
//     the existing selection machinery rather than fabricating a SearchResult:
//     history rows go through resolveHistorySelectionLaunch (same provider-lane
//     alignment + source-decision ledger as the history overlay), queue rows
//     claim their exact entry via beginPlayback, and bare identities get
//     lane-aligned + catalog-enriched exactly like a browse pick.
//
//   launchPaletteTitle — delivers the launch through the same channels a browse
//     selection would: a mounted browse session settles "launch-playback", a
//     mounted post-play session settles "history-entry". When nothing can take
//     it directly (playing surface, picker, idle), the launch is staged and the
//     next mounted session consumes it — mirroring the root-overlay promise
//     bridges instead of a staged overlay-intent global: the value is parked by
//     exactly one writer (here) and consumed by the two defined routes below.
// =============================================================================

import { applyTitleProviderPreferenceToSession } from "@/app/playback/playback-provider-switch";
import { enrichSelectedTitleIdentity } from "@/app/search/enrich-selected-title";
import type { Container } from "@/container";
import {
  episodeInfoFromMediaItemIdentity,
  titleInfoFromMediaItemIdentity,
} from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { localTitleLane, type LocalTitleEntry } from "@/domain/palette/local-title-index";
import {
  providerLaneToShellMode,
  providerPriorityForLane,
  resolveProviderLaneFromMetadata,
} from "@/domain/provider-lane";
import { isPlaybackSessionActive } from "@/domain/session/SessionState";
import type { EpisodeInfo, SearchResult, ShellMode, TitleInfo } from "@/domain/types";

import { resolveHistorySelectionLaunch } from "./history-selection-launch";
import {
  forceCloseRootContent,
  getRootContentSession,
  settleRootContentSessionWithFallback,
} from "./root-content-state";
import {
  claimQueuePlaybackLaunch,
  episodeInfoFromQueuePlaybackLaunch,
  titleInfoFromQueuePlaybackLaunch,
} from "./root-queue-bridge";
import type { BrowseShellResult, PlaybackShellResult } from "./types";

export type PaletteTitleLaunch = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

// --- staged handoff -----------------------------------------------------------
//
// Consumed by `openBrowseShell` (next browse mount) and `runPostPlaybackMenu`
// (post-play loop re-entry). Latest pick wins — a second Enter before the first
// launch lands simply replaces the parked value.

let stagedPaletteTitleLaunch: PaletteTitleLaunch | null = null;

export function stagePaletteTitleLaunch(launch: PaletteTitleLaunch): void {
  stagedPaletteTitleLaunch = launch;
}

export function takePaletteTitleLaunch(): PaletteTitleLaunch | null {
  const staged = stagedPaletteTitleLaunch;
  stagedPaletteTitleLaunch = null;
  return staged;
}

// --- resolution ---------------------------------------------------------------

function alignPaletteTitleSession(
  container: Container,
  entry: LocalTitleEntry,
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
): ShellMode {
  const { stateManager } = container;
  const providerMetadata = entry.providerId
    ? container.providerRegistry.get(entry.providerId)
    : undefined;

  if (providerMetadata) {
    const mode = providerLaneToShellMode(
      resolveProviderLaneFromMetadata(providerMetadata.metadata),
    );
    stateManager.dispatch({ type: "SET_MODE", mode, provider: providerMetadata.metadata.id });
    applyTitleProviderPreferenceToSession(container, entry.titleId, title, mode);
    return mode;
  }

  const lane = localTitleLane(entry);
  const mode = providerLaneToShellMode(lane);
  const fallbackProvider =
    providerPriorityForLane(container.config.getRaw(), lane)[0] ?? stateManager.getState().provider;
  stateManager.dispatch({ type: "SET_MODE", mode, provider: fallbackProvider });
  applyTitleProviderPreferenceToSession(container, entry.titleId, title, mode);
  return mode;
}

export async function resolvePaletteTitleLaunch(
  container: Container,
  entry: LocalTitleEntry,
): Promise<PaletteTitleLaunch | null> {
  if (entry.historyEntry) {
    return resolveHistorySelectionLaunch(
      container,
      { titleId: entry.titleId, entry: entry.historyEntry },
      "history",
    );
  }

  if (entry.queueEntryId) {
    const launch = claimQueuePlaybackLaunch(container.queueService, entry.queueEntryId);
    if (launch) {
      const title = titleInfoFromQueuePlaybackLaunch(launch);
      alignPaletteTitleSession(container, entry, title);
      const episode = episodeInfoFromQueuePlaybackLaunch(launch);
      return { title, ...(episode ? { episode } : {}) };
    }
    // Claim failed — the row went in-flight or was played between index build
    // and Enter. Fall through to the plain identity path so the pick still
    // lands on the right title instead of dying silently.
  }

  const identity: MediaItemIdentity = {
    mediaKind: entry.mediaKind,
    ...(entry.contentType ? { contentType: entry.contentType } : {}),
    titleId: entry.titleId,
    title: entry.title,
    ...(entry.season !== undefined ? { season: entry.season } : {}),
    ...(entry.episode !== undefined ? { episode: entry.episode } : {}),
    ...(entry.absoluteEpisode !== undefined ? { absoluteEpisode: entry.absoluteEpisode } : {}),
    ...(entry.providerId ? { providerHints: [{ providerId: entry.providerId }] } : {}),
    ...(entry.externalIds ? { externalIds: entry.externalIds } : {}),
  };

  let title: TitleInfo = {
    ...titleInfoFromMediaItemIdentity(identity),
    ...(entry.externalIds ? { externalIds: entry.externalIds } : {}),
    launchSource: "search",
  };
  const mode = alignPaletteTitleSession(container, entry, title);
  const episode = episodeInfoFromMediaItemIdentity(identity);

  if (!title.externalIds || (mode === "anime" && !title.externalIds.anilistId)) {
    // Same seam as a browse pick: fill the cross-catalog id bag so the episode
    // flow, tracker sync, and provider eligibility see the same identity.
    // Bounded + cached; offline just degrades to the local identity.
    title = await enrichSelectedTitleIdentity(container.catalogIdentityService, title, mode);
  }

  return { title, ...(episode ? { episode } : {}) };
}

// --- delivery -----------------------------------------------------------------

/**
 * Route a resolved launch to whichever surface can act on it:
 *
 *   playing        → stage + stop; the post-play loop consumes the staged pick
 *   post-play      → settle the mounted session as "history-entry"
 *   browse         → settle the mounted session as "launch-playback"
 *   picker/idle    → stage; the next mounted session consumes it
 *
 * Pickers in the way are settled with their own fallback (cancelled) so no
 * pending mount is left dangling behind the launch.
 */
export function launchPaletteTitle(container: Container, launch: PaletteTitleLaunch): void {
  const session = getRootContentSession();

  if (isPlaybackSessionActive(container.stateManager.getState().playbackStatus)) {
    stagePaletteTitleLaunch(launch);
    // A picker mounted over the playing surface blocks the post-play mount —
    // release it with its own fallback. The playback/loading session itself is
    // owned by the playback teardown that `stopCurrentPlayback` drives, so it
    // must NOT be settled here (its promise is the loop's contract).
    if (session?.kind === "picker") {
      settleRootContentSessionWithFallback();
    }
    void container.playerControl.stopCurrentPlayback("palette-title-pick");
    return;
  }

  if (session?.kind === "post-playback" || session?.kind === "playback") {
    if (
      forceCloseRootContent<PlaybackShellResult>({
        type: "history-entry",
        title: launch.title,
        ...(launch.episode ? { episode: launch.episode } : {}),
      })
    ) {
      return;
    }
  }

  if (session?.kind === "browse") {
    if (
      forceCloseRootContent<BrowseShellResult<SearchResult>>({
        type: "launch-playback",
        launch,
      })
    ) {
      return;
    }
  }

  stagePaletteTitleLaunch(launch);
  settleRootContentSessionWithFallback();
}

/** Shared `onTitlePick` wiring for palette hosts that hold a container. */
export function pickPaletteTitle(container: Container, entry: LocalTitleEntry): void {
  void resolvePaletteTitleLaunch(container, entry)
    .then((launch) => {
      if (launch) launchPaletteTitle(container, launch);
      return undefined;
    })
    .catch((error: unknown) => {
      container.logger.warn("Palette title launch failed", {
        titleId: entry.titleId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
