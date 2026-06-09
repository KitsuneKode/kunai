import type { TitleDetail } from "@/domain/catalog/title-detail";
import { episodeThumbKey } from "@/domain/catalog/title-detail";

import type { PostPlayRailFact, PostPlayUpNextCard } from "./post-play-view";

export function parseEpisodeTag(
  label: string | undefined,
): { season: number; episode: number } | undefined {
  if (!label?.trim()) return undefined;
  const match = label.trim().match(/S(\d+)E(\d+)/i);
  if (!match?.[1] || !match[2]) return undefined;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

export function resolveNextEpisodeThumbUrl(
  titleDetail: TitleDetail | undefined,
  nextEpisodeLabel: string | undefined,
): string | undefined {
  const parsed = parseEpisodeTag(nextEpisodeLabel);
  if (!parsed || !titleDetail?.artwork?.episodeThumbnails) return undefined;
  return titleDetail.artwork.episodeThumbnails[episodeThumbKey(parsed.season, parsed.episode)];
}

export function resolveSeriesPosterUrl(
  titleDetail: TitleDetail | undefined,
  fallbackPosterUrl: string | undefined,
): string | undefined {
  return titleDetail?.artwork?.poster ?? fallbackPosterUrl;
}

export type PlaybackPlayingRailView = {
  readonly facts: readonly PostPlayRailFact[];
  readonly synopsis?: string;
  readonly seriesPosterUrl?: string;
  readonly upNext?: PostPlayUpNextCard;
};

export function buildPlaybackPlayingRailView(input: {
  readonly title: string;
  readonly titleDetail?: TitleDetail;
  readonly posterUrl?: string;
  readonly upNextLabel?: string;
  readonly nextEpisodeLabel?: string;
  readonly currentSeason?: number;
  readonly isSeries: boolean;
}): PlaybackPlayingRailView {
  const facts: PostPlayRailFact[] = [];
  const detail = input.titleDetail;

  if (detail?.year) facts.push({ label: "year", value: detail.year });
  if (detail?.genres?.[0]) facts.push({ label: "genre", value: detail.genres[0] });
  if (input.isSeries && input.currentSeason) {
    facts.push({ label: "season", value: String(input.currentSeason) });
  }
  if (detail?.status === "airing") {
    facts.push({ label: "status", value: "airing", tone: "success" });
  } else if (detail?.status) {
    facts.push({ label: "status", value: detail.status });
  }
  if (input.isSeries && detail?.episodeCount) {
    facts.push({ label: "episodes", value: String(detail.episodeCount) });
  }
  if (!input.isSeries && detail?.runtimeMinutes) {
    facts.push({ label: "runtime", value: `${detail.runtimeMinutes}m` });
  }
  if (detail?.studios?.[0]) facts.push({ label: "studio", value: detail.studios[0] });

  const upNextLabel = input.upNextLabel?.trim();
  const upNext: PostPlayUpNextCard | undefined = upNextLabel
    ? {
        label: upNextLabel,
        meta: input.nextEpisodeLabel ? `next ${input.nextEpisodeLabel}` : "press n when ready",
      }
    : undefined;

  return {
    facts,
    synopsis: detail?.synopsis,
    seriesPosterUrl: resolveSeriesPosterUrl(detail, input.posterUrl),
    upNext,
  };
}
