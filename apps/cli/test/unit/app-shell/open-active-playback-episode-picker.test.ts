import { describe, expect, mock, test } from "bun:test";

import {
  type ActivePlaybackEpisodePickerDeps,
  openActivePlaybackEpisodePicker,
} from "@/app-shell/ink-shell";
import type { Container } from "@/container";
import { SessionStateManagerImpl } from "@/domain/session/SessionStateManager";
import type { EpisodePickerOption, TitleInfo } from "@/domain/types";

// Injected rather than mock.module'd: swapping the picker builder process-wide
// leaked this stub's hardcoded "1 eps" subtitle into playback-episode-picker's
// own suite whenever that file loaded after this one.
const buildPlaybackEpisodePickerOptionsMock = mock(async () => ({
  options: [{ value: "1:1", label: "Episode 1" }],
  subtitle: "Example Series  ·  S01  ·  1 eps",
  initialIndex: 0,
}));

const openSessionPickerMock = mock(async () => null);

const pickerDeps = {
  buildOptions: buildPlaybackEpisodePickerOptionsMock,
  openPicker: openSessionPickerMock,
} as unknown as ActivePlaybackEpisodePickerDeps;

const seriesTitle: TitleInfo = {
  id: "anilist:1",
  name: "Example Series",
  type: "series",
  isAnime: true,
};

const animeEpisodes: EpisodePickerOption[] = [
  { index: 1, label: "Episode 1 · Beginnings", detail: "Air date", name: "Beginnings" },
  { index: 2, label: "Episode 2 · Rising", detail: "Air date", name: "Rising" },
];

function createStateManager(): SessionStateManagerImpl {
  return new SessionStateManagerImpl({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as never,
  });
}

function createContainer(stateManager: SessionStateManagerImpl): Container {
  return {
    stateManager,
    historyRepository: {
      listByTitle: () => [],
    },
    playerControl: {
      selectCurrentPlaybackEpisode: mock(async () => {}),
    },
  } as unknown as Container;
}

describe("openActivePlaybackEpisodePicker", () => {
  test("passes session currentAnimeEpisodes into buildPlaybackEpisodePickerOptions", async () => {
    buildPlaybackEpisodePickerOptionsMock.mockClear();

    const stateManager = createStateManager();
    stateManager.dispatch({ type: "SET_MODE", mode: "anime", provider: "allanime" });
    stateManager.dispatch({ type: "SELECT_TITLE", title: seriesTitle });
    stateManager.dispatch({ type: "SELECT_EPISODE", episode: { season: 1, episode: 2 } });
    stateManager.dispatch({ type: "SET_CURRENT_ANIME_EPISODES", episodes: animeEpisodes });

    const container = createContainer(stateManager);
    await openActivePlaybackEpisodePicker(container, "test-episode-picker", pickerDeps);

    expect(buildPlaybackEpisodePickerOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        animeEpisodes,
      }),
    );
  });

  test("omits animeEpisodes when session cache is empty", async () => {
    buildPlaybackEpisodePickerOptionsMock.mockClear();

    const stateManager = createStateManager();
    stateManager.dispatch({ type: "SET_MODE", mode: "anime", provider: "allanime" });
    stateManager.dispatch({ type: "SELECT_TITLE", title: seriesTitle });
    stateManager.dispatch({ type: "SELECT_EPISODE", episode: { season: 1, episode: 2 } });
    expect(stateManager.getState().currentAnimeEpisodes).toBeNull();

    const container = createContainer(stateManager);
    await openActivePlaybackEpisodePicker(container, "test-episode-picker", pickerDeps);

    expect(buildPlaybackEpisodePickerOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        animeEpisodes: undefined,
      }),
    );
  });
});
