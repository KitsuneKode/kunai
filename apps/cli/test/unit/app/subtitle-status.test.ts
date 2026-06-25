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

test("projectPlaybackSubtitleState keeps disabled preference from hiding selected subtitles", () => {
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
    kind: "selected",
    label: "subtitle selected · preference off",
    tone: "success",
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
