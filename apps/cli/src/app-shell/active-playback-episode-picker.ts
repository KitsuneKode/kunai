import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import type { Container } from "@/container";
import { decodeEpisodeSelectionValue } from "@/domain/playback/episode-selection";
import { listReadyEpisodes } from "@/services/offline/offline-episode-index";
import type { SeasonSummary } from "@/tmdb";
import { providerEpisodeIdentitiesEqual } from "@kunai/types";

import { EPISODE_PICKER_SWITCH_SEASON, openSessionPicker } from "./session-picker";

/**
 * Collaborators of {@link openActivePlaybackEpisodePicker}. Injectable so tests
 * exercise the wiring without `mock.module`, which swaps the picker builder
 * process-wide and silently breaks whichever suites load afterwards.
 */
export type ActivePlaybackEpisodePickerDeps = {
  readonly buildOptions: typeof buildPlaybackEpisodePickerOptions;
  readonly openPicker: typeof openSessionPicker;
  /** Injectable season-catalog seam; production lazily imports TMDB to preserve startup cost. */
  readonly loadSeasons?: (titleId: string) => Promise<SeasonSummary[] | null>;
};

export async function openActivePlaybackEpisodePicker(
  container: Container,
  reason: string,
  deps: ActivePlaybackEpisodePickerDeps = {
    buildOptions: buildPlaybackEpisodePickerOptions,
    openPicker: openSessionPicker,
  },
): Promise<void> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const currentEpisode = state.currentEpisode;
  if (!title || title.type !== "series" || !currentEpisode) return;

  const watchedEntries = container.historyRepository.listByTitle(title.id);
  const isAnime = state.mode === "anime";
  const animeEpisodes = state.currentAnimeEpisodes ?? undefined;
  const local =
    state.stream?.playbackSourceKind === "local" || title.launchSource === "offline-library";
  const localEpisodes = local
    ? listReadyEpisodes(
        container.offlineAssetService,
        container.offlineTitleIdentity.resolveForTitle(title, state.mode),
      )
    : undefined;
  let pickerEpisode = currentEpisode;

  while (true) {
    const picker = await deps.buildOptions({
      title,
      currentEpisode: pickerEpisode,
      isAnime,
      animeEpisodeCount: title.episodeCount,
      animeEpisodes,
      watchedEntries,
      networkAllowed: !local,
      localEpisodes,
    });
    if (picker.options.length === 0) return;

    const picked = await deps.openPicker(container.stateManager, {
      type: "episode_picker",
      season: pickerEpisode.season,
      initialIndex: picker.initialIndex,
      options: picker.options,
    });
    if (!picked) return;

    if (picked === EPISODE_PICKER_SWITCH_SEASON) {
      // `s` mid-playback: hop seasons without leaving the episode picker flow.
      if (isAnime || local) continue;
      const { chooseSeasonFromOptions } = await import("./pickers");
      const loadSeasons =
        deps.loadSeasons ??
        (async (titleId: string) => (await import("@/tmdb")).fetchSeasonSummaries(titleId));
      const seasons = (await loadSeasons(title.id).catch(() => null)) ?? [];
      if (seasons.length === 0) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: "Could not load seasons — check the connection and retry",
        });
        return;
      }
      const nextSeason = await chooseSeasonFromOptions(
        seasons,
        pickerEpisode.season,
        undefined,
        container,
      );
      if (nextSeason === null) return;
      pickerEpisode =
        nextSeason === currentEpisode.season
          ? currentEpisode
          : { ...pickerEpisode, season: nextSeason, episode: 1 };
      continue;
    }

    const selection = decodeEpisodeSelectionValue(picked);
    if (!selection) return;
    if (
      selection.season === currentEpisode.season &&
      selection.episode === currentEpisode.episode &&
      providerEpisodeIdentitiesEqual(
        selection.providerEpisodeIdentity,
        currentEpisode.providerEpisodeIdentity,
      )
    ) {
      return;
    }

    await container.playerControl.selectCurrentPlaybackEpisode(selection, reason);
    return;
  }
}
