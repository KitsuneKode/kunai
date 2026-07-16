import type { ShellMode, ProviderLane } from "@/domain/types";
import { resolveProviderLaneFromMediaKinds } from "@kunai/core";
import type { MediaKind } from "@kunai/types";

export function shellModeToProviderLane(mode: ShellMode): ProviderLane {
  if (mode === "youtube") return "youtube";
  if (mode === "anime") return "anime";
  return "series";
}

export function providerLaneToShellMode(lane: ProviderLane): ShellMode {
  if (lane === "youtube") return "youtube";
  if (lane === "anime") return "anime";
  return "series";
}

export function providerLaneMatchesMode(lane: ProviderLane, mode: ShellMode): boolean {
  return lane === shellModeToProviderLane(mode);
}

export function resolveProviderLaneFromMetadata(metadata: {
  readonly isAnimeProvider: boolean;
  readonly isYoutubeProvider: boolean;
}): ProviderLane {
  if (metadata.isYoutubeProvider) return "youtube";
  if (metadata.isAnimeProvider) return "anime";
  return "series";
}

export function mediaKindsToProviderLane(mediaKinds: readonly MediaKind[]): ProviderLane {
  return resolveProviderLaneFromMediaKinds(mediaKinds);
}

export function shellModeToDefaultProviderKey(mode: ShellMode): "series" | "anime" | "youtube" {
  if (mode === "youtube") return "youtube";
  if (mode === "anime") return "anime";
  return "series";
}

export function providerMetadataMatchesLane(
  metadata: {
    readonly isAnimeProvider: boolean;
    readonly isYoutubeProvider: boolean;
  },
  lane: ProviderLane,
): boolean {
  if (lane === "youtube") return metadata.isYoutubeProvider;
  if (lane === "anime") return metadata.isAnimeProvider;
  return !metadata.isAnimeProvider && !metadata.isYoutubeProvider;
}

/**
 * Lanes the provider picker should offer: the mode's own lane plus any
 * cross-lane the active title's id bag unlocks (dual-lane resolve). A linked
 * anime (AniList unit with a TMDB id) can pick series providers and the
 * reverse; the resolve adapter maps kind/episode at request time.
 */
export function providerPickerLanesForTitle(
  lane: ProviderLane,
  eligibility: {
    readonly anime: boolean;
    readonly series: boolean;
    readonly youtube: boolean;
  } | null,
): readonly ProviderLane[] {
  if (lane === "youtube" || !eligibility || eligibility.youtube) return [lane];
  const lanes: ProviderLane[] = [lane];
  if (lane === "anime" && eligibility.series) lanes.push("series");
  if (lane === "series" && eligibility.anime) lanes.push("anime");
  return lanes;
}

export function providerPriorityForLane(
  config: {
    readonly provider: string;
    readonly providerPriority: readonly string[];
    readonly animeProvider: string;
    readonly animeProviderPriority: readonly string[];
    readonly youtubeProvider: string;
    readonly youtubeProviderPriority: readonly string[];
  },
  lane: ProviderLane,
): readonly string[] {
  if (lane === "youtube") return [config.youtubeProvider, ...config.youtubeProviderPriority];
  if (lane === "anime") return [config.animeProvider, ...config.animeProviderPriority];
  return [config.provider, ...config.providerPriority];
}
