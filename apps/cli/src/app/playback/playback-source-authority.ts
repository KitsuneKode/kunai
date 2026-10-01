import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

import {
  resolveLocalEpisodePlayback,
  type LocalEpisodePlaybackResolution,
} from "./episode-playback-source";

export type PlaybackSourceAuthority =
  | { readonly kind: "local"; readonly resolution: LocalEpisodePlaybackResolution }
  | { readonly kind: "provider" };

/**
 * Decide a verified local file before any provider lookup.
 * A missing provider or a network that cannot be asked does not get a vote
 * when this returns local.
 */
export async function resolvePlaybackSourceAuthority(
  container: Container,
  title: TitleInfo,
  episode: EpisodeInfo,
  options: {
    readonly entrypoint?: "online-search" | "continue" | "offline-library";
    readonly forceOnline?: boolean;
    readonly forceLocal?: boolean;
  } = {},
): Promise<PlaybackSourceAuthority> {
  const resolution = await resolveLocalEpisodePlayback(container, title, episode, options);
  if (!resolution) return { kind: "provider" };
  return { kind: "local", resolution };
}
