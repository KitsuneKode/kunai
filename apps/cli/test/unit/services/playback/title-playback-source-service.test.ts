import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TitlePlaybackSourceService } from "@/services/playback/TitlePlaybackSourceService";

describe("TitlePlaybackSourceService", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  test("round-trips title source preference per provider", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-title-source-"));
    const service = new TitlePlaybackSourceService(join(dir, "title-playback-sources.json"));

    await service.set({
      providerId: "vidking",
      titleId: "tmdb:123",
      sourceId: "source:zoro",
    });

    expect(await service.get({ providerId: "vidking", titleId: "tmdb:123" })).toMatchObject({
      sourceId: "source:zoro",
    });
    expect(await service.get({ providerId: "miruro", titleId: "tmdb:123" })).toBeNull();
  });

  test("delete removes preference", async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-title-source-"));
    const path = join(dir, "title-playback-sources.json");
    const service = new TitlePlaybackSourceService(path);

    await service.set({
      providerId: "vidking",
      titleId: "tmdb:123",
      sourceId: "source:zoro",
    });
    await service.delete({ providerId: "vidking", titleId: "tmdb:123" });

    expect(await service.get({ providerId: "vidking", titleId: "tmdb:123" })).toBeNull();
  });
});
