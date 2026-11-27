import type { EpisodeIdentity, ProviderId } from "@kunai/types";

/**
 * Provider requests follow the proven season-relative identity when it exists.
 * Absolute numbering is reserved for inputs that carry no relative episode.
 *
 * An absent or empty identity resolves to episode 1. Both callers are anime-only
 * providers, where a film is catalogued as its single first episode, so 1 is the
 * right request rather than a placeholder — see the default's test in
 * `test/provider-episode-number.test.ts`. Callers that must not guess should
 * resolve an episode before calling, not read a sentinel back out of this.
 */
export function selectProviderEpisodeNumber(episode: EpisodeIdentity | undefined): number {
  return episode?.episode ?? episode?.absoluteEpisode ?? 1;
}

export function episodeNumberFromProviderIdentity(
  episode: EpisodeIdentity | undefined,
  providerId: ProviderId,
): number | undefined {
  const identity = episode?.providerEpisodeIdentity;
  if (identity?.providerId !== providerId) return undefined;
  const match = /^ep:(\d+)$/.exec(identity.value);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}
