import { expect, test } from "bun:test";

import { KEYBINDINGS, type KeyBinding } from "@/app-shell/keybindings";
import {
  formatPlaybackSessionKeysHint,
  type PlaybackSessionKeysInput,
} from "@/app-shell/playback-session-key-hints";
import type { StreamInfo } from "@/domain/types";

const streamWithCandidates: StreamInfo = {
  url: "https://cdn.example/1080.m3u8",
  headers: { referer: "https://example.com" },
  timestamp: Date.now(),
  providerResolveResult: {
    status: "resolved",
    providerId: "vidking",
    selectedStreamId: "stream-1080",
    streams: [
      {
        id: "stream-1080",
        providerId: "vidking",
        sourceId: "source-a",
        protocol: "hls",
        container: "m3u8",
        audioLanguages: ["ja"],
        hardSubLanguage: "en",
        qualityLabel: "1080p",
        qualityRank: 1080,
        url: "https://cdn.example/1080.m3u8",
        headers: { referer: "https://example.com" },
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
      {
        id: "stream-720",
        providerId: "vidking",
        sourceId: "source-a",
        protocol: "hls",
        container: "m3u8",
        audioLanguages: ["en"],
        qualityLabel: "720p",
        qualityRank: 720,
        url: "https://cdn.example/720.m3u8",
        headers: { referer: "https://example.com" },
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    sources: [
      {
        id: "source-a",
        providerId: "vidking",
        kind: "mirror",
        status: "selected",
        confidence: 0.9,
      },
      {
        id: "source-b",
        providerId: "vidking",
        kind: "mirror",
        status: "available",
        confidence: 0.8,
      },
    ],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: new Date().toISOString(),
      cacheHit: false,
      title: {
        id: "1",
        kind: "series",
        title: "Demo",
      },
      steps: [],
      failures: [],
    },
    failures: [],
  },
};

function sessionInput(overrides: Partial<PlaybackSessionKeysInput> = {}): PlaybackSessionKeysInput {
  return {
    stream: streamWithCandidates,
    autoplayPaused: false,
    autoskipPaused: true,
    canToggleAutoplay: true,
    hasNextEpisode: true,
    hasPreviousEpisode: false,
    isSeries: true,
    stopAfterCurrent: false,
    ...overrides,
  };
}

test("formatPlaybackSessionKeysHint lists session state and only available nav keys", () => {
  const hint = formatPlaybackSessionKeysHint(sessionInput());

  expect(hint).toContain("autoplay on");
  expect(hint).toContain("autoskip paused");
  expect(hint).toContain("q stop");
  expect(hint).toContain("n / N next");
  expect(hint).not.toContain("p prev");
  expect(hint).not.toContain("-");
  expect(hint).not.toContain("k tracks");
  expect(hint).not.toContain("t tracks");
  expect(hint).toContain("o source");
  expect(hint).toContain("k / K quality");
  expect(hint).toContain("/ commands");
});

test("formatPlaybackSessionKeysHint follows the keybinding registry", () => {
  const bindings: readonly KeyBinding[] = KEYBINDINGS.map((binding) =>
    binding.id === "player-source"
      ? { ...binding, chord: { input: "z" }, display: undefined }
      : binding,
  );

  const hint = formatPlaybackSessionKeysHint(sessionInput(), bindings);

  expect(hint).toContain("z source");
  expect(hint).not.toContain("o source");
});

test("formatPlaybackSessionKeysHint hides series-only actions for one-off playback", () => {
  const hint = formatPlaybackSessionKeysHint(
    sessionInput({
      canToggleAutoplay: false,
      hasNextEpisode: false,
      hasPreviousEpisode: false,
      isSeries: false,
      stopAfterCurrent: false,
    }),
  );

  expect(hint).not.toContain("next");
  expect(hint).not.toContain("prev");
  expect(hint).not.toContain("stop after");
  expect(hint).not.toContain("autoplay");
  expect(hint).toContain("u autoskip");
});
