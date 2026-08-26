import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PlaybackSelectionCoordinator } from "@/app/playback/playback-selection-coordinator";
import { EpisodePlaybackSelectionService } from "@/services/playback/EpisodePlaybackSelectionService";
import { TitlePlaybackSourceService } from "@/services/playback/TitlePlaybackSourceService";

const ep = { season: 1, episode: 1 };
const ep2 = { season: 1, episode: 2 };

describe("PlaybackSelectionCoordinator", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function createCoordinator(titleId = "tmdb:99") {
    dir = await mkdtemp(join(tmpdir(), "kunai-selection-"));
    return new PlaybackSelectionCoordinator({
      titleId,
      episodePlaybackSelection: new EpisodePlaybackSelectionService(
        join(dir, "episode-playback-selections.json"),
      ),
      titlePlaybackSource: new TitlePlaybackSourceService(join(dir, "title-playback-sources.json")),
    });
  }

  test("manual source pick applies to later episodes via title default", async () => {
    const coordinator = await createCoordinator();

    await coordinator.applyManualSourcePick("vidking", ep, "source:zoro");
    await coordinator.hydrateTitleSource("vidking");

    expect(coordinator.getEffective("vidking", ep2)).toEqual({
      sourceId: "source:zoro",
      streamId: null,
    });
  });

  test("episode override wins over title default", async () => {
    const coordinator = await createCoordinator();
    await coordinator.applyManualSourcePick("vidking", ep, "source:zoro");
    await coordinator.hydrateTitleSource("vidking");
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

  test("automatic failover stays episode-local and does not replace the title default", async () => {
    const coordinator = await createCoordinator();
    await coordinator.applyManualSourcePick("videasy", ep, "source:yoru");
    await coordinator.applyAutomaticSourceFailover("videasy", ep, "source:neon");

    expect(coordinator.getEffective("videasy", ep)).toEqual({
      sourceId: "source:neon",
      streamId: null,
    });
    expect(coordinator.getEffective("videasy", ep2)).toEqual({
      sourceId: "source:yoru",
      streamId: null,
    });
  });

  test("persisted episode overrides do not alias different provider-native episodes", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-selection-"));
    const path = join(dir, "episode-playback-selections.json");
    const nativeZero = {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "0" },
    };
    const nativeOne = {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "1" },
    };
    const writer = new PlaybackSelectionCoordinator({
      titleId: "anilist:1",
      episodePlaybackSelection: new EpisodePlaybackSelectionService(path),
      titlePlaybackSource: new TitlePlaybackSourceService(join(dir, "title-sources.json")),
    });
    await writer.applyEpisodeSelection("allanime", nativeZero, {
      sourceId: "source:native-zero",
      streamId: null,
    });

    const reader = new PlaybackSelectionCoordinator({
      titleId: "anilist:1",
      episodePlaybackSelection: new EpisodePlaybackSelectionService(path),
      titlePlaybackSource: new TitlePlaybackSourceService(join(dir, "title-sources.json")),
    });
    await reader.hydrateEpisode("allanime", nativeOne);

    expect(reader.getEffective("allanime", nativeOne)).toEqual({
      sourceId: null,
      streamId: null,
    });
  });
});
