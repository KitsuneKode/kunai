import { chooseFromListShell } from "@/app-shell/pickers/choose-from-list-shell";
import type { ListShellActionContext } from "@/app-shell/pickers/list-shell-types";
import { openSessionPicker } from "@/app-shell/session-picker";
import { describeEpisodeWatchPresentation } from "@/app/playback-episode-picker";
import type { Container } from "@/container";
import { isFinished } from "@/services/persistence/HistoryStore";
import type { EpisodeInfo } from "@/tmdb";

type EpisodeStatusEntry = { readonly tone: "success" | "warning"; readonly badge: string };

async function buildEpisodeStatusMap(
  container: Container | undefined,
  titleId: string | undefined,
  season: number,
  episodes: readonly EpisodeInfo[],
): Promise<Map<number, EpisodeStatusEntry>> {
  const map = new Map<number, EpisodeStatusEntry>();
  if (!container || !titleId) return map;

  const allEntries = await container.historyStore.listByTitle(titleId);
  const seasonEntries = allEntries.filter((e) => e.season === season);
  if (seasonEntries.length === 0) return map;

  for (const entry of seasonEntries) {
    if (!map.has(entry.episode)) {
      if (isFinished(entry)) {
        const presentation = describeEpisodeWatchPresentation(entry);
        map.set(entry.episode, { tone: "success", badge: presentation.badge ?? "watched" });
      } else if (entry.timestamp > 0) {
        const presentation = describeEpisodeWatchPresentation(entry);
        map.set(entry.episode, {
          tone: "warning",
          badge: presentation.badge ?? "resume",
        });
      }
    }
  }

  const maxWatched = Math.max(...seasonEntries.map((e) => e.episode));
  for (const ep of episodes) {
    if (ep.number < maxWatched && !map.has(ep.number)) {
      map.set(ep.number, { tone: "success", badge: "✓" });
    }
  }

  return map;
}

export async function chooseSeasonFromOptions(
  seasons: readonly number[],
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (seasons.length === 0) return null;
  if (seasons.length === 1) return seasons[0] ?? currentSeason;

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "season_picker",
      currentSeason,
      options: seasons.map((season) => ({
        value: String(season),
        label: season === currentSeason ? `Season ${season}  ·  current` : `Season ${season}`,
      })),
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseFromListShell({
    title: "Choose season",
    subtitle: `Current season ${currentSeason}`,
    actionContext,
    options: seasons.map((season) => ({
      value: season,
      label: season === currentSeason ? `Season ${season}  ·  current` : `Season ${season}`,
    })),
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

  const episodeStatus = await buildEpisodeStatusMap(container, titleId, season, episodes);

  let watchedSubtitle: string | null = null;
  if (episodeStatus.size > 0) {
    const finishedCount = [...episodeStatus.values()].filter((s) => s.tone === "success").length;
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
      options: episodes.map((episode) => {
        const status = episodeStatus.get(episode.number);
        return {
          value: String(episode.number),
          label: `Episode ${episode.number}  ·  ${episode.name}`,
          detail: episode.airDate || "unknown year",
          tone: status?.tone ?? (episode.number === currentEpisode ? "info" : undefined),
          badge:
            episode.number === currentEpisode
              ? status?.badge
                ? `▶ ${status.badge}`
                : "▶"
              : status?.badge,
        };
      }),
    });
    if (!picked) return null;
    return episodes.find((episode) => String(episode.number) === picked) ?? null;
  }

  return chooseFromListShell({
    title: "Choose episode",
    subtitle: `Season ${season}  ·  ${watchedSubtitle ?? `Current episode ${currentEpisode}`}`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode,
      label:
        episode.number === currentEpisode
          ? `Episode ${episode.number}  ·  ${episode.name}  ·  current`
          : `Episode ${episode.number}  ·  ${episode.name}`,
      detail: episode.airDate || "unknown year",
    })),
  });
}
