import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EpisodePlaybackSelectionService } from "@/services/playback/EpisodePlaybackSelectionService";

describe("EpisodePlaybackSelectionService", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  test("round-trips episode selection per provider/title/episode", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-episode-selection-"));
    const service = new EpisodePlaybackSelectionService(
      join(dir, "episode-playback-selections.json"),
    );

    await service.set({
      providerId: "vidking",
      titleId: "tmdb:123",
      season: 1,
      episode: 2,
      sourceId: "source:zoro",
      streamId: "stream:1",
    });

    expect(
      await service.get({
        providerId: "vidking",
        titleId: "tmdb:123",
        season: 1,
        episode: 2,
      }),
    ).toMatchObject({
      sourceId: "source:zoro",
      streamId: "stream:1",
    });

    expect(
      await service.get({
        providerId: "vidking",
        titleId: "tmdb:123",
        season: 1,
        episode: 3,
      }),
    ).toBeNull();
  });

  test("persists selections across service instances", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-episode-selection-"));
    const path = join(dir, "episode-playback-selections.json");
    const writer = new EpisodePlaybackSelectionService(path);
    await writer.set({
      providerId: "miruro",
      titleId: "tmdb:99",
      season: 2,
      episode: 1,
      sourceId: "source:sub",
    });

    const reader = new EpisodePlaybackSelectionService(path);
    expect(
      await reader.get({
        providerId: "miruro",
        titleId: "tmdb:99",
        season: 2,
        episode: 1,
      }),
    ).toMatchObject({ sourceId: "source:sub" });
  });
});
