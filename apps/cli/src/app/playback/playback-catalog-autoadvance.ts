import type { AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import { evaluateAutoAdvanceNextUp } from "@/app/playback/policies/auto-advance-policy";
import {
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  type AutoAdvanceArgs,
} from "@/app/playback/policies/playback-result-policy";
import { formatCaughtUpReleaseBanner } from "@/app/post-play/caught-up-banner";
import type { NextUp } from "@/domain/playback/resolve-next-up";
import type { EpisodeInfo } from "@/domain/types";
import type { CatalogScheduleService } from "@/services/catalog/CatalogScheduleService";

export type CatalogAutoAdvancePlan = {
  readonly nextEpisode: EpisodeInfo | null;
  readonly catalogAutoNext: NextUp | null;
  readonly catalogAutoplayEndBanner: string | undefined;
  readonly blockedBy: string | null;
};

/**
 * Pure catalog auto-advance planning extracted from PlaybackPhase outer loop.
 * Side effects (countdown, navigate, diagnostics) remain in the phase.
 */
export async function planCatalogAutoAdvance(input: {
  readonly autoplayAdvanceArgs: AutoAdvanceArgs;
  readonly guards: AutoAdvanceGuards;
  readonly seriesDone: boolean;
  readonly autoplayRecommendations: boolean;
  readonly isAnime: boolean;
  readonly anilistTitleId?: string;
  readonly catalogScheduleService?: Pick<CatalogScheduleService, "peekNextRelease">;
  readonly nowMs?: number;
}): Promise<CatalogAutoAdvancePlan> {
  const nextEpisode = await resolveAutoplayAdvanceEpisode(input.autoplayAdvanceArgs);
  const catalogAutoNext = evaluateAutoAdvanceNextUp({
    guards: input.guards,
    nextEpisode,
    queueHead: undefined,
    topRecommendation: null,
    seriesDone: input.seriesDone,
    autoplayRecommendations: input.autoplayRecommendations,
  });

  if (catalogAutoNext?.kind === "episode") {
    return { nextEpisode, catalogAutoNext, catalogAutoplayEndBanner: undefined, blockedBy: null };
  }

  const blockedBy = explainAutoplayBlockReason(input.autoplayAdvanceArgs);
  let catalogAutoplayEndBanner = explainAutoplayNoNextEpisodeCatalogHint({
    ...input.autoplayAdvanceArgs,
    isAnime: input.isAnime,
  });

  if (
    input.isAnime &&
    input.anilistTitleId?.startsWith("anilist:") &&
    input.catalogScheduleService
  ) {
    const schedule = input.catalogScheduleService.peekNextRelease("anilist", input.anilistTitleId);
    const scheduledBanner = formatCaughtUpReleaseBanner({
      episode: schedule?.episode,
      releaseAt: schedule?.releaseAt,
      now: input.nowMs ?? Date.now(),
    });
    if (scheduledBanner) {
      catalogAutoplayEndBanner = scheduledBanner;
    }
  }

  return { nextEpisode, catalogAutoNext, catalogAutoplayEndBanner, blockedBy };
}
