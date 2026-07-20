import { describe, expect, mock, test } from "bun:test";

import type { Container } from "@/container";
import { SessionStateManagerImpl } from "@/domain/session/SessionStateManager";
import type { EpisodePickerOption, TitleInfo } from "@/domain/types";

const buildPlaybackEpisodePickerOptionsMock = mock(async () => ({
  options: [{ value: "1:1", label: "Episode 1" }],
  subtitle: "Example Series  ·  S01  ·  1 eps",
  initialIndex: 0,
}));

mock.module("@/app/playback/playback-episode-picker", () => ({
  buildPlaybackEpisodePickerOptions: buildPlaybackEpisodePickerOptionsMock,
}));

mock.module("@/app-shell/session-picker", () => ({
  openSessionPicker: mock(async () => null),
  EPISODE_PICKER_SWITCH_SEASON: "__switch_season__",
}));

const { openActivePlaybackEpisodePicker } = await import("@/app-shell/ink-shell");

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
    await openActivePlaybackEpisodePicker(container, "test-episode-picker");

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
    await openActivePlaybackEpisodePicker(container, "test-episode-picker");

    expect(buildPlaybackEpisodePickerOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        animeEpisodes: undefined,
      }),
    );
  });
});
