import { describe, expect, test } from "bun:test";

import { PlaybackSelectionCoordinator } from "@/app/playback-selection-coordinator";
import { EpisodePlaybackSelectionService } from "@/services/playback/EpisodePlaybackSelectionService";
import { TitlePlaybackSourceService } from "@/services/playback/TitlePlaybackSourceService";

const ep = { season: 1, episode: 1 };
const ep2 = { season: 1, episode: 2 };

describe("PlaybackSelectionCoordinator", () => {
  test("manual source pick applies to later episodes via title default", async () => {
    class MockEpisodeStore {
      readonly data = new Map<string, unknown>();
      async get() {
        return null;
      }
      async set(input: Record<string, unknown>) {
        this.data.set(JSON.stringify(input), input);
      }
    }

    class MockTitleStore {
      data: { sourceId: string; updatedAt: string } | null = null;
      async get() {
        return this.data;
      }
      async set(input: { sourceId: string }) {
        this.data = { sourceId: input.sourceId, updatedAt: "now" };
      }
    }

    const coordinator = new PlaybackSelectionCoordinator({
      titleId: "tmdb:99",
      episodePlaybackSelection:
        new MockEpisodeStore() as unknown as EpisodePlaybackSelectionService,
      titlePlaybackSource: new MockTitleStore() as unknown as TitlePlaybackSourceService,
    });

    await coordinator.applyManualSourcePick("vidking", ep, "source:zoro");
    await coordinator.hydrateTitleSource("vidking");

    expect(coordinator.getEffective("vidking", ep2)).toEqual({
      sourceId: "source:zoro",
      streamId: null,
    });
  });

  test("episode override wins over title default", async () => {
    const episodeStore = {
      async get() {
        return null;
      },
      async set() {},
    } as unknown as EpisodePlaybackSelectionService;

    const titleStore = {
      async get() {
        return {
          providerId: "vidking",
          titleId: "tmdb:99",
          sourceId: "source:zoro",
          updatedAt: "",
        };
      },
      async set() {},
    } as unknown as TitlePlaybackSourceService;

    const coordinator = new PlaybackSelectionCoordinator({
      titleId: "tmdb:99",
      episodePlaybackSelection: episodeStore,
      titlePlaybackSource: titleStore,
    });

    await coordinator.hydrate("vidking", ep2);
    await coordinator.applyEpisodeSelection("vidking", ep2, {
      sourceId: "source:nani",
      streamId: null,
    });

    expect(coordinator.getEffective("vidking", ep2)).toEqual({
      sourceId: "source:nani",
      streamId: null,
    });
  });
});
