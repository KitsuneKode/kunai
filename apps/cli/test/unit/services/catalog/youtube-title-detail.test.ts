import { afterEach, expect, test } from "bun:test";

import { applyCatalogDetailToTitle } from "@/domain/catalog/apply-title-detail";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
import {
  fetchTitleDetail,
  clearTitleDetailCache,
  peekTitleDetail,
} from "@/services/catalog/TitleDetailService";
import { readResolvedYoutubeTitleDetail } from "@/services/youtube/youtube-title-detail";
import {
  configureYoutubeProvider,
  YOUTUBE_METADATA_SCHEMA_VERSION,
} from "@kunai/providers/youtube";
import type { YoutubeVideoMetadata } from "@kunai/providers/youtube";

afterEach(() => {
  configureYoutubeProvider({});
  clearTitleDetailCache();
});

for (const type of ["movie", "series"] as const) {
  test(`YouTube handoff preserves existing ${type} catalog detail and artwork`, () => {
    const metadata: YoutubeVideoMetadata = {
      schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
      videoId: "aqz-KE-bpKQ",
      title: "Big Buck Bunny",
      thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      uploader: "Blender",
      qualities: [],
      subtitles: [],
    };
    configureYoutubeProvider({
      metadataService: { get: () => metadata, getOrFetch: async () => metadata },
    });
    const catalog: TitleDetail = {
      id: "tmdb:550",
      type,
      title: "Catalog title",
      synopsis: "Known synopsis",
      runtimeMinutes: 139,
      externalIds: { tmdbId: "550", youtubeChannelId: "known-channel" },
      artwork: {
        poster: "catalog-poster",
        backdrop: "catalog-backdrop",
        contributingSources: ["tmdb"],
      },
      videoMeta: { paid: false, durationSeconds: 634 },
      sources: ["tmdb"],
    };
    const title = { id: catalog.id, type, externalIds: { youtubeId: metadata.videoId } };
    const detail = readResolvedYoutubeTitleDetail(title, undefined, catalog);
    expect(detail).toMatchObject({
      synopsis: catalog.synopsis,
      runtimeMinutes: catalog.runtimeMinutes,
      externalIds: {
        tmdbId: "550",
        youtubeId: metadata.videoId,
        youtubeChannelId: "known-channel",
      },
      artwork: { poster: "catalog-poster", backdrop: "catalog-backdrop" },
      videoMeta: { paid: false, durationSeconds: 634, channelTitle: "Blender" },
      sources: ["tmdb", "provider"],
    });
    expect(
      readResolvedYoutubeTitleDetail(title, undefined, { ...catalog, id: "tmdb:other" }),
    ).not.toHaveProperty("synopsis");
    expect(
      readResolvedYoutubeTitleDetail(title, undefined, {
        ...catalog,
        type: type === "movie" ? "series" : "movie",
      }),
    ).not.toHaveProperty("synopsis");
  });
}

test("resolved YouTube enrichment is optional when its metadata cache fails, while cancellation propagates", () => {
  const controller = new AbortController();
  let cancelDuringRead = false;
  const failure = new Error("Metadata cache unavailable");
  configureYoutubeProvider({
    metadataService: {
      get: () => {
        if (cancelDuringRead) controller.abort();
        throw failure;
      },
      getOrFetch: async () => null,
    },
  });
  const title = { id: "youtube:aqz-KE-bpKQ", type: "movie" as const };
  expect(readResolvedYoutubeTitleDetail(title, controller.signal)).toBeUndefined();
  cancelDuringRead = true;
  expect(() => readResolvedYoutubeTitleDetail(title, controller.signal)).toThrow(failure);
  expect(() => readResolvedYoutubeTitleDetail(title, controller.signal)).toThrow();
});

test("explicit successful YouTube handoff can enrich a mixed identity without changing generic catalog routing", () => {
  const metadata: YoutubeVideoMetadata = {
    schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
    videoId: "aqz-KE-bpKQ",
    title: "Big Buck Bunny",
    qualities: [],
    subtitles: [],
  };
  configureYoutubeProvider({
    metadataService: { get: () => metadata, getOrFetch: async () => metadata },
  });
  expect(
    readResolvedYoutubeTitleDetail({
      id: "tmdb:550",
      type: "movie",
      externalIds: { youtubeId: metadata.videoId },
    })?.title,
  ).toBe("Big Buck Bunny");
});

test("resolved YouTube metadata replaces an earlier empty catalog answer without another fetch", async () => {
  let metadata: YoutubeVideoMetadata | null = null;
  configureYoutubeProvider({
    metadataService: {
      get: () => metadata,
      getOrFetch: async () => {
        throw new Error("No new metadata request expected");
      },
    },
  });
  const id = "youtube:aqz-KE-bpKQ";
  const title = { id, type: "movie" as const, name: id, externalIds: { youtubeId: "aqz-KE-bpKQ" } };
  const empty = await fetchTitleDetail(id, "movie");
  expect(applyCatalogDetailToTitle(title, empty).name).toBe(id);
  metadata = {
    schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
    videoId: "aqz-KE-bpKQ",
    title: "Big Buck Bunny",
    thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
    uploader: "Blender",
    channelId: "channel-1",
    durationSeconds: 634,
    viewCount: 42,
    qualities: [],
    subtitles: [],
  };
  const detail = await fetchTitleDetail(id, "movie");
  expect(detail.title).toBe("Big Buck Bunny");
  expect(applyCatalogDetailToTitle(title, detail).posterUrl).toBe(metadata.thumbnail);
  expect(peekTitleDetail(id, "movie")).toEqual(detail);
  expect(detail).toMatchObject({
    sources: ["provider"],
    videoMeta: { channelTitle: "Blender", durationSeconds: 634, viewCount: 42 },
  });
  expect(detail.videoMeta).not.toHaveProperty("resultKind");
  expect(detail.videoMeta).not.toHaveProperty("liveStatus");
});

test("a different cached video cannot enrich the current video or its playlist", () => {
  const metadata: YoutubeVideoMetadata = {
    schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
    videoId: "wrong-video",
    title: "Wrong title",
    qualities: [],
    subtitles: [],
  };
  configureYoutubeProvider({
    metadataService: { get: () => metadata, getOrFetch: async () => metadata },
  });
  expect(peekTitleDetail("youtube:aqz-KE-bpKQ", "movie")).toBeUndefined();
  expect(peekTitleDetail("youtube:playlist:PL123", "series")).toBeUndefined();
});

test("late video detail enriches the matching session without resetting playback or known facts", () => {
  const id = "youtube:aqz-KE-bpKQ";
  const selected = reduceState(
    createInitialState("vidlink", "hianime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    }),
    {
      type: "SELECT_TITLE",
      title: { id, name: id, type: "movie" },
      videoMeta: {
        channelTitle: "Known channel",
        paid: false,
        resultKind: "short",
        liveStatus: "none",
      },
    },
  );
  const playing = reduceState(selected, { type: "SET_PLAYBACK_STATUS", status: "playing" });
  const detail = {
    id,
    type: "movie" as const,
    title: "Big Buck Bunny",
    videoMeta: { durationSeconds: 634 },
  };
  const enriched = reduceState(playing, {
    type: "SET_TITLE_DETAIL",
    titleId: id,
    titleType: "movie",
    detail,
  });
  expect(enriched.currentTitle?.name).toBe(detail.title);
  expect(enriched.videoMeta).toEqual({
    channelTitle: "Known channel",
    paid: false,
    resultKind: "short",
    liveStatus: "none",
    durationSeconds: 634,
  });
  expect(enriched.playbackStatus).toBe("playing");
  expect(
    reduceState(playing, {
      type: "SET_TITLE_DETAIL",
      titleId: "youtube:another",
      titleType: "movie",
      detail,
    }),
  ).toBe(playing);
  expect(
    reduceState(playing, {
      type: "SET_TITLE_DETAIL",
      titleId: id,
      titleType: "movie",
      detail: { ...detail, id: "youtube:another" },
    }),
  ).toBe(playing);
});
