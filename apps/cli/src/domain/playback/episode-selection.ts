import type { EpisodeInfo } from "@/domain/types";
import { decodeProviderEpisodeIdentity } from "@kunai/types";

export function decodeEpisodeSelectionValue(value: string): EpisodeInfo | null {
  const first = value.indexOf(":");
  const second = value.indexOf(":", first + 1);
  if (first < 0) return null;
  const season = Number(value.slice(0, first));
  const episode = Number(value.slice(first + 1, second < 0 ? undefined : second));
  if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 1 || episode < 1)
    return null;
  if (second < 0) return { season, episode };
  const providerEpisodeIdentity = decodeProviderEpisodeIdentity(value.slice(second + 1));
  return providerEpisodeIdentity ? { season, episode, providerEpisodeIdentity } : null;
}
