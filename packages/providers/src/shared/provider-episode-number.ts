import type { EpisodeIdentity } from "@kunai/types";

/**
 * Provider requests follow the proven season-relative identity when it exists.
 * Absolute numbering is reserved for inputs that carry no relative episode.
 */
export function selectProviderEpisodeNumber(episode: EpisodeIdentity | undefined): number {
  return episode?.episode ?? episode?.absoluteEpisode ?? 1;
}
