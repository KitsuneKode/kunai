// =============================================================================
// playable-ref.ts — surface-agnostic "play this" identity + pure intent builder
//
// `mediaKind` is content truth; it is the ONLY thing that decides labels /
// episode / autoplay — never ShellMode (which is provider routing only).
// =============================================================================

import type { ShellMode } from "@/domain/types";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

export type PlayableSource =
  | "search"
  | "history"
  | "continue"
  | "recommendation"
  | "trending"
  | "queue"
  | "offline"
  | "calendar";

/**
 * Surface-agnostic "play this" identity. Every surface builds a PlayableRef and
 * calls the single play() entry. `mediaKind` is content truth.
 */
export interface PlayableRef {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly title: string;
  readonly season?: number; // series/anime only
  readonly episode?: number; // series/anime only
  readonly absoluteEpisode?: number;
  readonly externalIds?: ProviderExternalIds;
  readonly providerHint?: string;
  readonly resumeSeconds?: number;
  readonly source: PlayableSource;
}

export interface PlayIntentEpisode {
  readonly season: number;
  readonly episode: number;
  readonly absoluteEpisode?: number;
}

export interface PlayIntent {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: MediaKind;
  /** Provider routing only. `"anime"` for anime, `"series"` (general) otherwise. */
  readonly mode: ShellMode;
  /** Present for series/anime, ALWAYS undefined for movie. */
  readonly episode?: PlayIntentEpisode;
  readonly autoplayEligible: boolean;
  /** 0 = start fresh. */
  readonly resumeSeconds: number;
  readonly providerHint?: string;
  readonly externalIds?: ProviderExternalIds;
  readonly source: PlayableSource;
}

/**
 * Pure mapping from a PlayableRef to a PlayIntent. Enforces the invariants that
 * fix the movie-misclassification bug class:
 *  - movie ⇒ no episode, autoplay disabled (regardless of supplied season/episode);
 *  - mode is derived from mediaKind for provider routing only;
 *  - series/anime default to S1E1 on first watch; anime falls back to absoluteEpisode.
 */
export function buildPlayIntent(ref: PlayableRef): PlayIntent {
  const mode: ShellMode = ref.mediaKind === "anime" ? "anime" : "series";
  const isMovie = ref.mediaKind === "movie";

  const episode: PlayIntentEpisode | undefined = isMovie
    ? undefined
    : {
        season: ref.season ?? 1,
        episode: ref.episode ?? ref.absoluteEpisode ?? 1,
        ...(ref.absoluteEpisode === undefined ? {} : { absoluteEpisode: ref.absoluteEpisode }),
      };

  const resumeSeconds =
    typeof ref.resumeSeconds === "number" &&
    Number.isFinite(ref.resumeSeconds) &&
    ref.resumeSeconds > 0
      ? ref.resumeSeconds
      : 0;

  return {
    titleId: ref.titleId,
    title: ref.title,
    mediaKind: ref.mediaKind,
    mode,
    episode,
    autoplayEligible: !isMovie,
    resumeSeconds,
    providerHint: ref.providerHint,
    externalIds: ref.externalIds,
    source: ref.source,
  };
}
