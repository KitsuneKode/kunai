import { chooseFromListShell } from "@/app-shell/pickers/choose-from-list-shell";
import type { ListShellActionContext } from "@/app-shell/pickers/list-shell-types";
import { openSessionPicker } from "@/app-shell/session-picker";
import { describeEpisodeWatchPresentation } from "@/app/playback/playback-episode-picker";
import type { Container } from "@/container";
import type { OverlayPickerOption } from "@/domain/session/SessionState";
import {
  formatEpisodePickerDetail,
  formatEpisodePickerLabel,
  formatEpisodePreviewSynopsis,
} from "@/services/catalog/episode-display";
import { isFinished } from "@/services/continuation/history-progress";
import type { EpisodeInfo, SeasonSummary } from "@/tmdb";

type EpisodeStatusEntry = { readonly tone: "success" | "warning"; readonly badge: string };
type SeasonPickerEntry = number | Pick<SeasonSummary, "number" | "name" | "posterPath">;

async function buildEpisodeStatusMap(
  container: Container | undefined,
  titleId: string | undefined,
  season: number,
  episodes: readonly EpisodeInfo[],
): Promise<Map<number, EpisodeStatusEntry>> {
  const map = new Map<number, EpisodeStatusEntry>();
  if (!container || !titleId) return map;

  const allEntries = container.historyRepository.listByTitle(titleId);
  const seasonEntries = allEntries.filter((e) => (e.season ?? 1) === season);
  if (seasonEntries.length === 0) return map;

  for (const entry of seasonEntries) {
    const episodeNumber = entry.episode ?? entry.absoluteEpisode;
    if (episodeNumber === undefined) continue;
    if (!map.has(episodeNumber)) {
      if (isFinished(entry)) {
        const presentation = describeEpisodeWatchPresentation(entry);
        map.set(episodeNumber, { tone: "success", badge: presentation.badge ?? "watched" });
      } else if (entry.positionSeconds > 0) {
        const presentation = describeEpisodeWatchPresentation(entry);
        map.set(episodeNumber, {
          tone: "warning",
          badge: presentation.badge ?? "resume",
        });
      }
    }
  }

  const maxWatched = Math.max(...seasonEntries.map((e) => e.episode ?? e.absoluteEpisode ?? 0));
  for (const ep of episodes) {
    if (ep.number < maxWatched && !map.has(ep.number)) {
      map.set(ep.number, { tone: "success", badge: "✓" });
    }
  }

  return map;
}

function normalizeSeasonEntry(season: SeasonPickerEntry): Pick<SeasonSummary, "number" | "name"> & {
  readonly posterPath?: string;
} {
  if (typeof season === "number") {
    return { number: season, name: `Season ${season}` };
  }
  return {
    number: season.number,
    name: season.name || `Season ${season.number}`,
    posterPath: season.posterPath,
  };
}

export function buildSeasonPickerOptions(
  seasons: readonly SeasonPickerEntry[],
  currentSeason: number,
): OverlayPickerOption[] {
  return seasons.map((season) => {
    const entry = normalizeSeasonEntry(season);
    return {
      value: String(entry.number),
      label: entry.number === currentSeason ? `${entry.name}  ·  current` : entry.name,
      previewImageUrl: entry.posterPath,
    };
  });
}

export async function chooseSeasonFromOptions(
  seasons: readonly SeasonPickerEntry[],
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (seasons.length === 0) return null;
  if (seasons.length === 1) return normalizeSeasonEntry(seasons[0] ?? currentSeason).number;

  const options = buildSeasonPickerOptions(seasons, currentSeason);

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "season_picker",
      currentSeason,
      options,
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseFromListShell({
    title: "Choose season",
    subtitle: `Current season ${currentSeason}`,
    actionContext,
    options: options.map((option) => ({
      value: Number.parseInt(option.value, 10),
      label: option.label,
      previewImageUrl: option.previewImageUrl,
    })),
  });
}

export async function buildEpisodePickerOptions({
  episodes,
  season,
  currentEpisode,
  container,
  titleId,
}: {
  episodes: readonly EpisodeInfo[];
  season: number;
  currentEpisode: number;
  container?: Container;
  titleId?: string;
}): Promise<OverlayPickerOption[]> {
  const episodeStatus = await buildEpisodeStatusMap(container, titleId, season, episodes);
  return episodes.map((episode) => {
    const status = episodeStatus.get(episode.number);
    return {
      value: String(episode.number),
      label: formatEpisodePickerLabel(episode.number, episode.name, episode.overview),
      detail: formatEpisodePickerDetail({
        airDate: episode.airDate,
        overview: episode.overview,
        runtimeMinutes: episode.runtimeMinutes,
      }),
      previewBody: formatEpisodePreviewSynopsis(episode.overview),
      // Consistent glyph grammar (label stays neutral; badge is the only color):
      // ✓ watched (mint) · N% in-progress (rose) · ▸ current (rose).
      tone:
        status?.tone === "success"
          ? "success"
          : status?.tone === "warning"
            ? "warning"
            : episode.number === currentEpisode
              ? "warning"
              : undefined,
      badge:
        status?.tone === "success"
          ? "✓"
          : status?.tone === "warning"
            ? status.badge
            : episode.number === currentEpisode
              ? "▸"
              : undefined,
      previewImageUrl: episode.stillPath,
    };
  });
}

export async function chooseEpisodeFromOptions(
  episodes: readonly EpisodeInfo[],
  season: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
  titleId?: string,
): Promise<EpisodeInfo | null> {
  if (episodes.length === 0) return null;

  const options = await buildEpisodePickerOptions({
    episodes,
    season,
    currentEpisode,
    container,
    titleId,
  });

  let watchedSubtitle: string | null = null;
  if (options.length > 0) {
    const finishedCount = options.filter((option) => option.tone === "success").length;
    if (finishedCount > 0) {
      watchedSubtitle = `${finishedCount}/${episodes.length} watched`;
    }
  }

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "episode_picker",
      season,
      initialIndex: Math.max(
        0,
        episodes.findIndex((episode) => episode.number === currentEpisode),
      ),
      options,
    });
    if (!picked) return null;
    return episodes.find((episode) => String(episode.number) === picked) ?? null;
  }

  const fallbackEpisode = episodes[0];
  if (!fallbackEpisode) return null;

  return chooseFromListShell({
    title: "Choose episode",
    subtitle: `Season ${season}  ·  ${watchedSubtitle ?? `Current episode ${currentEpisode}`}`,
    actionContext,
    options: options.map((option) => ({
      value: episodes.find((episode) => String(episode.number) === option.value) ?? fallbackEpisode,
      label: option.label,
      detail: option.detail,
      previewImageUrl: option.previewImageUrl,
    })),
  });
}
