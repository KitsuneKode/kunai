import {
  chooseEpisodeFromOptions,
  chooseFromListShell,
  chooseSeasonFromOptions,
  type ListShellActionContext,
} from "@/app-shell/pickers";
import { buildTracksPanelData } from "@/app-shell/tracks-panel-data";
import type { Container } from "@/container";
import {
  annotateCurrentTrackFailure,
  decodeTrackSelection,
  type DecodedTrackSelection,
  type TrackCapabilitySection,
} from "@/domain/playback/track-capabilities";
import type { EpisodePickerOption, StreamInfo } from "@/domain/types";
import { scheduleVideasyLazySourceProbesFromContainer } from "@/services/playback/schedule-videasy-lazy-probes";
import { fetchEpisodes, fetchSeasonSummaries, type EpisodeInfo } from "@/tmdb";

import { createSessionPickerId, openSessionPicker, waitForSessionPicker } from "../session-picker";

export async function openProviderPicker({
  currentProvider,
  providers,
  actionContext,
}: {
  currentProvider: string;
  providers: readonly import("@/domain/types").ProviderMetadata[];
  actionContext?: ListShellActionContext;
}): Promise<string | null> {
  return chooseFromListShell({
    title: "Choose provider",
    subtitle: `Current provider ${currentProvider}`,
    actionContext,
    options: providers.map((provider) => ({
      value: provider.id,
      label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
      detail: provider.description,
    })),
  });
}

export async function openSubtitlePicker(
  entries: ReadonlyArray<{
    url: string;
    display?: string;
    language?: string;
    release?: string;
    sourceKind?: "embedded" | "external";
    sourceName?: string;
  }>,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<string | null> {
  const describeSubtitleEntry = (entry: {
    language?: string;
    release?: string;
    sourceKind?: "embedded" | "external";
    sourceName?: string;
  }): string => {
    const parts = [entry.language ?? "unknown"];
    if (entry.sourceKind === "embedded") {
      parts.push("built-in");
    } else if (entry.sourceKind === "external") {
      parts.push("external");
    }
    if (entry.sourceName) {
      parts.push(entry.sourceName);
    }
    if (entry.release) {
      parts.push(entry.release);
    }
    return parts.join("  ·  ");
  };

  if (container) {
    return await openSessionPicker(container.stateManager, {
      type: "subtitle_picker",
      options: entries.map((entry) => ({
        value: entry.url,
        label: entry.display ?? entry.language ?? "Unknown track",
        detail: describeSubtitleEntry(entry),
      })),
    });
  }

  return chooseFromListShell({
    title: "Choose subtitles",
    subtitle: `${entries.length} tracks available`,
    actionContext,
    options: entries.map((entry) => ({
      value: entry.url,
      label: entry.display ?? entry.language ?? "Unknown track",
      detail: describeSubtitleEntry(entry),
    })),
  });
}

/**
 * Open the unified Tracks panel and await a switchable selection. `/tracks`
 * opens the whole surface; `/source` and `/quality` deep-link focus into their
 * section. Returns the decoded `{ section, value }` the caller applies through
 * the existing stream-selection handlers, or null when the user backs out (or
 * there was nothing switchable to resolve).
 */
export async function openTracksPanel(
  stream: StreamInfo | null,
  options: { initialSection?: TrackCapabilitySection; failedCurrentReason?: string },
  container: Container,
): Promise<DecodedTrackSelection | null> {
  const panelData = await buildTracksPanelData(stream, container);
  const groups = options.failedCurrentReason
    ? annotateCurrentTrackFailure(panelData.groups, options.failedCurrentReason)
    : panelData.groups;
  const id = createSessionPickerId("tracks_panel");
  container.stateManager.dispatch({
    type: "OPEN_OVERLAY",
    overlay: {
      type: "tracks_panel",
      id,
      groups,
      initialSection: options.initialSection,
      favorites: container.config.favoriteSources,
      providerLabel: panelData.providerLabel,
    },
  });

  if (stream) {
    scheduleVideasyLazySourceProbesFromContainer(container, stream, {
      onInventoryUpdated: async (nextStream) => {
        container.stateManager.dispatch({ type: "SET_STREAM", stream: nextStream });
        const refreshed = await buildTracksPanelData(nextStream, container);
        const refreshedGroups = options.failedCurrentReason
          ? annotateCurrentTrackFailure(refreshed.groups, options.failedCurrentReason)
          : refreshed.groups;
        container.stateManager.dispatch({
          type: "UPDATE_TRACKS_PANEL_GROUPS",
          id,
          groups: refreshedGroups,
          providerLabel: refreshed.providerLabel,
        });
      },
    });
  }

  const resolved = await waitForSessionPicker(container.stateManager, id);
  return resolved ? decodeTrackSelection(resolved) : null;
}

export async function openSeasonPicker(
  tmdbId: string,
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const seasons = await fetchSeasonSummaries(tmdbId);
  if (!seasons) return null;
  return chooseSeasonFromOptions(seasons, currentSeason, actionContext, container);
}

export async function openEpisodePicker(
  tmdbId: string,
  season: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<EpisodeInfo | null> {
  const episodes = await fetchEpisodes(tmdbId, season);
  return chooseEpisodeFromOptions(episodes ?? [], season, currentEpisode, actionContext, container);
}

export async function openAnimeEpisodePicker(
  count: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const episodes = Array.from({ length: count }, (_, index) => index + 1);
  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "episode_picker",
      season: 1,
      initialIndex: Math.max(0, currentEpisode - 1),
      options: episodes.map((episode) => ({
        value: String(episode),
        label: `Episode ${episode}`,
        tone: episode === currentEpisode ? "info" : undefined,
        badge: episode === currentEpisode ? "current" : undefined,
      })),
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }
  return chooseFromListShell({
    title: "Choose episode",
    subtitle: `${count} episodes available`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode,
      label: episode === currentEpisode ? `Episode ${episode}  ·  current` : `Episode ${episode}`,
    })),
  });
}

export async function openAnimeEpisodeListPicker(
  episodes: readonly EpisodePickerOption[],
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (episodes.length === 0) return null;

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "episode_picker",
      season: 1,
      initialIndex: Math.max(
        0,
        episodes.findIndex((episode) => episode.index === currentEpisode),
      ),
      options: episodes.map((episode) => ({
        value: String(episode.index),
        label: episode.label,
        detail: episode.detail,
        previewImageUrl: episode.previewImageUrl,
        tone: episode.index === currentEpisode ? "info" : undefined,
        badge: episode.index === currentEpisode ? "current" : undefined,
      })),
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseFromListShell({
    title: "Choose episode",
    subtitle: `${episodes.length} episodes available`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode.index,
      label: episode.index === currentEpisode ? `${episode.label}  ·  current` : episode.label,
      detail: episode.detail,
    })),
  });
}
