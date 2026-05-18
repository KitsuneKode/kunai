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
        subtitle: formatEpisodePickerSubtitle({
          seriesName: title.name,
          season: 1,
          options,
        }),
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
      subtitle: formatEpisodePickerSubtitle({
        seriesName: title.name,
        season: 1,
        options,
      }),
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
    subtitle: formatEpisodePickerSubtitle({
      seriesName: title.name,
      season: currentEpisode.season,
      options,
    }),
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

export function renderEpisodeWatchProgressBar(percentage: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.max(
    0,
    Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)),
  );
  const emptyBlocks = totalBlocks - filledBlocks;
  return `[${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}]`;
}

export function formatEpisodePickerSubtitle({
  seriesName,
  season,
  options,
}: {
  readonly seriesName: string;
  readonly season: number;
  readonly options: readonly ShellPickerOption<string>[];
}): string {
  const total = options.length;
  const watched = options.filter((option) => option.tone === "success").length;
  const progress = total > 0 ? Math.round((watched / total) * 100) : 0;
  const parts = [seriesName, `S${String(season).padStart(2, "0")}`, `${total} eps`];
  if (progress > 0) parts.push(`${progress}% complete`);
  return parts.join("  ·  ");
}

export function describeEpisodeWatchPresentation(
  entry: HistoryEntry | undefined,
): EpisodeWatchPresentation {
  if (!entry) return { watched: false, inProgress: false };
  if (isFinished(entry)) {
    const dateLabel = relativeDate(entry.watchedAt);
    return {
      detail: dateLabel ? `watched  ·  ${dateLabel}` : "watched",
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

function relativeDate(isoDate: string): string | undefined {
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 13) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function buildEpisodePickerOption({
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
  const displayLabel = current ? `▶  ${label}` : label;
  return {
    value: `${season}:${episode}`,
    label: displayLabel,
    detail: mergeEpisodeDetail(history, watch.detail, releaseBadge, baseDetail),
    tone:
      watch.tone === "success"
        ? "success"
        : current
          ? "info"
          : watch.tone === "warning"
            ? "warning"
            : undefined,
    badge: current && watch.badge && watch.badge !== "watched" ? watch.badge : watch.badge,
  };
}

function mergeEpisodeDetail(
  history: HistoryEntry | undefined,
  watchedDetail?: string,
  releaseBadge?: string,
  baseDetail?: string,
): string | undefined {
  const parts: string[] = [];
  if (history && history.duration > 0 && !isFinished(history)) {
    const percentage = Math.max(
      1,
      Math.min(99, Math.round((history.timestamp / history.duration) * 100)),
    );
    parts.push(renderEpisodeWatchProgressBar(percentage));
  }
  if (watchedDetail) parts.push(watchedDetail);
  if (releaseBadge) parts.push(releaseBadge);
  if (baseDetail) parts.push(baseDetail);
  return parts.length > 0 ? parts.join("  ·  ") : undefined;
}

function getInitialIndex(options: readonly ShellPickerOption<string>[], value: string): number {
  return Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
}
