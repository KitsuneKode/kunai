import type { ShellPickerOption } from "@/app-shell/types";
import type { ShellStatusTone } from "@/app-shell/types";
import type { EpisodeInfo, EpisodePickerOption, TitleInfo } from "@/domain/types";
import {
  formatTimestamp,
  isFinished,
  type HistoryEntry,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes } from "@/tmdb";

export type PlaybackEpisodePickerInput = {
  title: TitleInfo;
  currentEpisode: EpisodeInfo;
  isAnime: boolean;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
  watchedEntries?: readonly HistoryEntry[];
  releaseBadges?: ReadonlyMap<string, string>;
  loadEpisodes?: typeof fetchEpisodes;
};

export type PlaybackEpisodePickerOptions = {
  options: readonly ShellPickerOption<string>[];
  subtitle: string;
  initialIndex: number;
};

export async function buildPlaybackEpisodePickerOptions({
  title,
  currentEpisode,
  isAnime,
  animeEpisodeCount,
  animeEpisodes,
  watchedEntries = [],
  releaseBadges,
  loadEpisodes = fetchEpisodes,
}: PlaybackEpisodePickerInput): Promise<PlaybackEpisodePickerOptions> {
  const watchedByEpisode = new Map(
    watchedEntries.map((entry) => [`${entry.season}:${entry.episode}`, entry] as const),
  );

  if (title.type !== "series") {
    return {
      options: [],
      subtitle: "Episode picker is only available for episodic playback",
      initialIndex: 0,
    };
  }

  if (isAnime) {
    if (animeEpisodes && animeEpisodes.length > 0) {
      const options = animeEpisodes.map((entry) =>
        buildEpisodePickerOption({
          season: 1,
          episode: entry.index,
          label: entry.label,
          baseDetail: entry.detail,
          releaseBadge: releaseBadges?.get(`1:${entry.index}`),
          current: entry.index === currentEpisode.episode,
          history: watchedByEpisode.get(`1:${entry.index}`),
        }),
      );
      return {
        subtitle: describeEpisodePickerSubtitle(
          `${animeEpisodes.length} released episodes available`,
          options,
        ),
        options,
        initialIndex: getInitialIndex(options, `${1}:${currentEpisode.episode}`),
      };
    }

    const fallbackCount = Math.max(
      animeEpisodeCount ?? title.episodeCount ?? 0,
      currentEpisode.episode,
    );
    const options = Array.from({ length: fallbackCount }, (_, index) => index + 1).map((episode) =>
      buildEpisodePickerOption({
        season: 1,
        episode,
        label: `Episode ${episode}`,
        releaseBadge: releaseBadges?.get(`1:${episode}`),
        current: episode === currentEpisode.episode,
        history: watchedByEpisode.get(`1:${episode}`),
      }),
    );
    return {
      subtitle: describeEpisodePickerSubtitle(`${fallbackCount} episode slots available`, options),
      options,
      initialIndex: getInitialIndex(options, `${1}:${currentEpisode.episode}`),
    };
  }

  const episodes = (await loadEpisodes(title.id, currentEpisode.season)) ?? [];
  const options = episodes.map((entry) =>
    buildEpisodePickerOption({
      season: currentEpisode.season,
      episode: entry.number,
      label: `Episode ${entry.number}  ·  ${entry.name}`,
      baseDetail: entry.airDate || "unknown year",
      releaseBadge: releaseBadges?.get(`${currentEpisode.season}:${entry.number}`),
      current: entry.number === currentEpisode.episode,
      history: watchedByEpisode.get(`${currentEpisode.season}:${entry.number}`),
    }),
  );
  return {
    subtitle: describeEpisodePickerSubtitle(
      `Season ${currentEpisode.season}  ·  ${episodes.length} episodes`,
      options,
    ),
    options,
    initialIndex: getInitialIndex(options, `${currentEpisode.season}:${currentEpisode.episode}`),
  };
}

export type EpisodeWatchPresentation = {
  detail?: string;
  tone?: ShellStatusTone;
  badge?: string;
  watched: boolean;
  inProgress: boolean;
};

export function describeEpisodeWatchPresentation(
  entry: HistoryEntry | undefined,
): EpisodeWatchPresentation {
  if (!entry) return { watched: false, inProgress: false };
  if (isFinished(entry)) {
    return {
      detail: "watched 100%",
      tone: "success",
      badge: "watched",
      watched: true,
      inProgress: false,
    };
  }

  const percent =
    entry.duration > 0
      ? Math.max(1, Math.min(99, Math.round((entry.timestamp / entry.duration) * 100)))
      : null;
  return {
    detail:
      percent === null
        ? `resume ${formatTimestamp(entry.timestamp)}`
        : `resume ${formatTimestamp(entry.timestamp)}  ·  ${percent}% watched`,
    tone: "warning",
    badge: percent === null ? "resume" : `${percent}%`,
    watched: false,
    inProgress: true,
  };
}

function buildEpisodePickerOption({
  season,
  episode,
  label,
  baseDetail,
  releaseBadge,
  current,
  history,
}: {
  season: number;
  episode: number;
  label: string;
  baseDetail?: string;
  releaseBadge?: string;
  current: boolean;
  history?: HistoryEntry;
}): ShellPickerOption<string> {
  const watch = describeEpisodeWatchPresentation(history);
  return {
    value: `${season}:${episode}`,
    label,
    detail: mergeEpisodeDetail(watch.detail, releaseBadge, baseDetail),
    tone: watch.tone ?? (current ? "info" : undefined),
    badge: current ? "current" : watch.badge,
  };
}

function mergeEpisodeDetail(
  watchedDetail?: string,
  releaseBadge?: string,
  baseDetail?: string,
): string | undefined {
  return [watchedDetail, releaseBadge, baseDetail].filter(Boolean).join("  ·  ") || undefined;
}

function describeEpisodePickerSubtitle(
  baseSubtitle: string,
  options: readonly ShellPickerOption<string>[],
): string {
  const watched = options.filter((option) => option.tone === "success").length;
  const inProgress = options.filter((option) => option.tone === "warning").length;
  const parts = [baseSubtitle];
  if (watched > 0) parts.push(`${watched} watched`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  return parts.join("  ·  ");
}

function getInitialIndex(options: readonly ShellPickerOption<string>[], value: string): number {
  return Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
}
