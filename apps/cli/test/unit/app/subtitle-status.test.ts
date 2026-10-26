import { expect, test } from "bun:test";

import {
  describePlaybackSubtitleStatus,
  projectPlaybackSubtitleState,
} from "@/app/playback/subtitle-status";
import type { StreamInfo } from "@/domain/types";

const hardsubStream: StreamInfo = {
  url: "https://cdn.example/1080.m3u8",
  headers: {},
  timestamp: Date.now(),
  providerResolveResult: {
    status: "resolved",
    providerId: "allanime",
    selectedStreamId: "sub-en",
    streams: [
      {
        id: "sub-en",
        providerId: "allanime",
        sourceId: "source-a",
        protocol: "hls",
        qualityLabel: "1080p",
        qualityRank: 1080,
        audioLanguages: ["ja"],
        hardSubLanguage: "en",
        url: "https://cdn.example/1080.m3u8",
        headers: {},
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    sources: [],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: new Date().toISOString(),
      cacheHit: false,
      title: { id: "1", kind: "series", title: "Demo" },
      steps: [],
      failures: [],
    },
    failures: [],
  },
};

test("describePlaybackSubtitleStatus treats hardsub inventory as subtitles available", () => {
  expect(describePlaybackSubtitleStatus(hardsubStream, "en")).toBe("hardsub en");
});

test("describePlaybackSubtitleStatus keeps true missing subtitles explicit", () => {
  expect(
    describePlaybackSubtitleStatus(
      {
        url: "https://cdn.example/1080.m3u8",
        headers: {},
        timestamp: Date.now(),
      },
      "en",
    ),
  ).toBe("subtitles not found");
});

test("projectPlaybackSubtitleState keeps resolved inventory from overriding the disabled startup preference", () => {
  const state = projectPlaybackSubtitleState(
    {
      url: "https://cdn.example/1080.m3u8",
      headers: {},
      subtitle: "https://cdn.example/en.vtt",
      timestamp: Date.now(),
    },
    "none",
  );

  expect(state).toMatchObject({
    kind: "disabled",
    label: "subtitles disabled",
    tone: "info",
  });
});

test("projectPlaybackSubtitleState exposes late lookup pending and failed states", () => {
  const stream: StreamInfo = {
    url: "https://cdn.example/1080.m3u8",
    headers: {},
    timestamp: Date.now(),
  };

  expect(projectPlaybackSubtitleState(stream, "en", { lateLookup: "pending" })).toMatchObject({
    kind: "late-lookup-pending",
    label: "subtitle lookup pending",
  });
  expect(projectPlaybackSubtitleState(stream, "en", { lateLookup: "failed" })).toMatchObject({
    kind: "lookup-failed",
    label: "subtitle lookup failed",
  });
});

test("projectPlaybackSubtitleState exposes active mpv attachment separately from selection", () => {
  expect(projectPlaybackSubtitleState(undefined, "en", { attached: true })).toMatchObject({
    kind: "attached",
    label: "subtitle attached",
    tone: "success",
  });
});

test("projectPlaybackSubtitleState describes YouTube subtitle preference with all tracks attached", () => {
  const youtubeStream: StreamInfo = {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    headers: {},
    timestamp: Date.now(),
    requiresYtdl: true,
  };

  expect(projectPlaybackSubtitleState(youtubeStream, "en")).toMatchObject({
    kind: "available",
    label: "YouTube subtitles · prefer English · all tracks attached",
    tone: "success",
  });
  expect(projectPlaybackSubtitleState(youtubeStream, "none")).toMatchObject({
    kind: "disabled",
    label: "subtitles disabled",
  });
  expect(projectPlaybackSubtitleState(youtubeStream, "en", { lateLookup: "failed" })).toMatchObject(
    {
      kind: "lookup-failed",
      label: "subtitles not found",
    },
  );
});

test("live mpv selection and visibility outrank URL inventory and startup defaults", () => {
  const stream: StreamInfo = {
    url: "https://video.example/file.mkv",
    headers: {},
    timestamp: 1,
    subtitle: "https://subs.example/stale.vtt",
    playbackSubtitle: { id: 3, visible: true, language: "ja", title: "Embedded Japanese" },
  };
  expect(projectPlaybackSubtitleState(stream, "none")).toMatchObject({
    kind: "selected",
    label: "subtitle playing · Embedded Japanese",
  });
  expect(
    projectPlaybackSubtitleState({ ...stream, playbackSubtitle: { id: 3, visible: false } }, "en"),
  ).toMatchObject({
    kind: "disabled",
    label: "subtitles hidden in mpv",
  });
  expect(
    projectPlaybackSubtitleState({ ...stream, playbackSubtitle: { id: 0, visible: true } }, "en", {
      attached: true,
    }),
  ).toMatchObject({
    kind: "disabled",
    label: "subtitles off in mpv",
  });
});

test("live YouTube embedded captions need no external subtitle URL", () => {
  expect(
    projectPlaybackSubtitleState(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        headers: {},
        timestamp: 1,
        playbackSubtitle: { id: 1, visible: true, language: "en" },
      },
      "none",
    ),
  ).toMatchObject({ kind: "selected", label: "subtitle playing · en" });
});

test("native Off takes precedence over visibility when no subtitle is selected", () => {
  expect(
    projectPlaybackSubtitleState(
      {
        url: "https://media.example/movie.mp4",
        headers: {},
        timestamp: Date.now(),
        playbackSubtitle: { id: 0, visible: false },
      },
      "en",
    ).label,
  ).toBe("subtitles off in mpv");
});
