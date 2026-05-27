import { expect, test } from "bun:test";

import {
  applyPreferredStreamSelection,
  buildPlaybackControlSummary,
  buildMediaTrackPickerOptions,
  buildQualityPickerOptions,
  buildSourcePickerOptions,
  buildStreamPickerOptions,
  decodeMediaTrackPickerSelection,
  formatPlaybackSessionFactsStrip,
  formatPlaybackSessionKeysHint,
  isCurrentStreamSelection,
  streamSelectionFromSource,
  streamSelectionFromStream,
  streamSelectionFromTrackPick,
} from "@/app/source-quality";
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
      {
        id: "stream-480-source-b",
        providerId: "vidking",
        sourceId: "source-b",
        protocol: "hls",
        qualityLabel: "480p",
        qualityRank: 480,
        url: "https://cdn.example/source-b-480.m3u8",
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

const streamWithSubtitles: StreamInfo = {
  ...streamWithCandidates,
  providerResolveResult: {
    ...streamWithCandidates.providerResolveResult!,
    subtitles: [
      {
        id: "sub-en",
        providerId: "vidking",
        sourceId: "source-a",
        variantId: "variant-1080",
        url: "https://subs.example/en.vtt",
        language: "en",
        source: "provider",
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "subtitle-list",
          scope: "local",
          keyParts: [],
        },
      },
      {
        id: "sub-fr",
        providerId: "vidking",
        sourceId: "source-a",
        url: "https://subs.example/fr.vtt",
        language: "fr",
        source: "provider",
        confidence: 0.8,
        cachePolicy: {
          ttlClass: "subtitle-list",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    streams: streamWithCandidates.providerResolveResult!.streams.map((candidate) =>
      candidate.id === "stream-1080"
        ? {
            ...candidate,
            variantId: "variant-1080",
            artwork: { seekBarVttUrl: "https://cdn.example/timing.vtt" },
            metadata: { intro: { start: 90, end: 180 } },
          }
        : candidate,
    ),
  },
};

test("buildSourcePickerOptions includes current source label", () => {
  const options = buildSourcePickerOptions(streamWithCandidates);
  expect(options[0]?.label).toContain("current");
  expect(options.map((option) => option.value)).toEqual(["source-a", "source-b"]);
});

test("buildSourcePickerOptions summarizes quality and language inventory", () => {
  const options = buildSourcePickerOptions(streamWithCandidates);
  expect(options[0]?.detail).toContain("quality 1080p/720p");
  expect(options[0]?.detail).toContain("audio ja/en");
  expect(options[0]?.detail).toContain("hardsub en");
});

test("buildSourcePickerOptions includes provider health and host hints", () => {
  const stream = {
    ...streamWithCandidates,
    providerResolveResult: {
      ...streamWithCandidates.providerResolveResult!,
      sources: [
        {
          id: "source-a",
          providerId: "vidking",
          kind: "mirror",
          status: "selected",
          host: "fast.example",
          confidence: 0.9,
        },
        {
          id: "source-b",
          providerId: "vidking",
          kind: "mirror",
          status: "failed",
          host: "slow.example",
          confidence: 0.8,
        },
      ],
    },
  } satisfies StreamInfo;

  const options = buildSourcePickerOptions(stream);

  expect(options.find((option) => option.value === "source-a")?.detail).toContain(
    "selected  ·  host fast.example",
  );
  expect(options.find((option) => option.value === "source-b")?.detail).toContain(
    "✕ failed  ·  host slow.example",
  );
});

test("buildSourcePickerOptions distinguishes soft subtitles from hardsub inventory", () => {
  const options = buildSourcePickerOptions(streamWithSubtitles);
  expect(options[0]?.detail).toContain("hardsub en");
  expect(options[0]?.detail).toContain("soft subs en/fr");
});

test("buildQualityPickerOptions sorts by highest quality first", () => {
  const options = buildQualityPickerOptions(streamWithCandidates);
  expect(options.map((option) => option.value)).toEqual([
    "stream-1080",
    "stream-720",
    "stream-480-source-b",
  ]);
});

test("buildQualityPickerOptions exposes audio and hard-subtitle language details", () => {
  const options = buildQualityPickerOptions(streamWithCandidates);
  expect(options[0]?.detail).toContain("hls  ·  m3u8  ·  audio ja  ·  hardsub en");
  expect(options[1]?.detail).toContain("hls  ·  m3u8  ·  audio en");
});

test("buildQualityPickerOptions shows soft subtitles linked to the selected variant", () => {
  const options = buildQualityPickerOptions(streamWithSubtitles);
  expect(options[0]?.detail).toContain("hls  ·  m3u8  ·  audio ja  ·  hardsub en  ·  soft subs en");
});

test("buildQualityPickerOptions includes selected host timing and subtitle hints", () => {
  const options = buildQualityPickerOptions(streamWithSubtitles);
  expect(options[0]?.detail).toContain("selected");
  expect(options[0]?.detail).toContain("host cdn.example");
  expect(options[0]?.detail).toContain("has timing");
  expect(options[0]?.detail).toContain("seek thumbnails");
  expect(options[0]?.detail).toContain("1 subtitle");
});

test("buildPlaybackControlSummary exposes compact hybrid UI affordances", () => {
  const summary = buildPlaybackControlSummary({
    ...streamWithSubtitles,
    subtitle: "https://subs.example/en.vtt",
  });

  expect(summary).toMatchObject({
    hasInventory: true,
    sourceCount: 2,
    streamCount: 3,
    qualityCount: 3,
    audioLanguages: ["ja", "en"],
    hardSubLanguages: ["en"],
    softSubtitleLanguages: ["en", "fr"],
    showSourceControl: true,
    showQualityControl: true,
    showMediaTrackControl: true,
    summary: "vidking",
  });
  expect(summary.detail).toContain("2 sources");
  expect(summary.detail).toContain("quality 1080p/720p/480p");
  expect(summary.detail).toContain("audio ja/en");
  expect(summary.detail).toContain("soft subs en/fr");
});

test("formatPlaybackSessionFactsStrip surfaces stream inventory only", () => {
  const strip = formatPlaybackSessionFactsStrip({
    stream: streamWithSubtitles,
    autoplayPaused: false,
    autoskipPaused: true,
    canToggleAutoplay: true,
    stopAfterCurrent: true,
    isSeries: true,
  });

  expect(strip).toContain("2 sources");
  expect(strip).not.toContain("autoplay");
  expect(strip).not.toContain("autoskip");
});

test("formatPlaybackSessionKeysHint lists session state and only available nav keys", () => {
  const hint = formatPlaybackSessionKeysHint({
    stream: streamWithSubtitles,
    autoplayPaused: false,
    autoskipPaused: true,
    canToggleAutoplay: true,
    hasNextEpisode: true,
    hasPreviousEpisode: false,
    isSeries: true,
    stopAfterCurrent: false,
  });

  expect(hint).toContain("autoplay on");
  expect(hint).toContain("autoskip paused");
  expect(hint).toContain("q stop");
  expect(hint).toContain("n next");
  expect(hint).not.toContain("p prev");
  expect(hint).not.toContain("—");
  expect(hint).toContain("k tracks");
  expect(hint).toContain("o source");
  expect(hint).toContain("v quality");
  expect(hint).toContain("/ commands");
});

test("buildPlaybackControlSummary keeps one-off direct streams compact", () => {
  expect(buildPlaybackControlSummary(null)).toEqual({
    hasInventory: false,
    sourceCount: 0,
    streamCount: 0,
    qualityCount: 0,
    audioLanguages: [],
    hardSubLanguages: [],
    softSubtitleLanguages: [],
    showSourceControl: false,
    showQualityControl: false,
    showMediaTrackControl: false,
    summary: "direct stream",
  });
});

test("buildStreamPickerOptions combines source quality audio and subtitle details", () => {
  const options = buildStreamPickerOptions(streamWithCandidates);

  expect(options.map((option) => option.value)).toEqual([
    "stream-1080",
    "stream-720",
    "stream-480-source-b",
  ]);
  expect(options[0]?.label).toBe("source-a  ·  1080p  ·  current");
  expect(options[0]?.detail).toBe("hls  ·  m3u8  ·  audio ja  ·  hardsub en");
  expect(options[1]?.label).toBe("source-a  ·  720p");
  expect(options[1]?.detail).toBe("hls  ·  m3u8  ·  audio en");
});

test("buildMediaTrackPickerOptions combines streams and soft subtitle controls", () => {
  const options = buildMediaTrackPickerOptions({
    ...streamWithSubtitles,
    subtitle: "https://subs.example/en.vtt",
    subtitleList: [
      { url: "https://subs.example/en.vtt", language: "en", display: "English" },
      { url: "https://subs.example/fr.vtt", language: "fr", display: "French" },
    ],
  });

  expect(options.map((option) => option.value)).toEqual([
    "stream:stream-1080",
    "stream:stream-720",
    "stream:stream-480-source-b",
    "audio:ja:stream-1080",
    "audio:en:stream-720",
    "hardsub:en:stream-1080",
    "subtitle:https%3A%2F%2Fsubs.example%2Fen.vtt",
    "subtitle:https%3A%2F%2Fsubs.example%2Ffr.vtt",
    "subtitle:none",
  ]);
  // Language badges come from the normalized ISO code + role via the typed seam.
  expect(options.find((option) => option.value === "audio:ja:stream-1080")?.label).toBe(
    "JA audio  ·  current",
  );
  expect(options.find((option) => option.value === "audio:en:stream-720")?.detail).toContain(
    "Switches to cached stream inventory",
  );
  expect(options.find((option) => option.value === "hardsub:en:stream-1080")?.label).toBe(
    "EN hardsub  ·  current",
  );
  expect(options.find((option) => option.value === "subtitle:none")?.label).toBe("Subtitles off");
});

test("decodeMediaTrackPickerSelection decodes stream language subtitle and subtitle-off choices", () => {
  expect(decodeMediaTrackPickerSelection("stream:stream-720")).toEqual({
    kind: "stream",
    streamId: "stream-720",
  });
  expect(decodeMediaTrackPickerSelection("audio:en:stream-720")).toEqual({
    kind: "audio",
    language: "en",
    streamId: "stream-720",
  });
  expect(decodeMediaTrackPickerSelection("hardsub:en:stream-1080")).toEqual({
    kind: "hardsub",
    language: "en",
    streamId: "stream-1080",
  });
  expect(decodeMediaTrackPickerSelection("subtitle:https%3A%2F%2Fsubs.example%2Fen.vtt")).toEqual({
    kind: "subtitle",
    subtitleUrl: "https://subs.example/en.vtt",
  });
  expect(decodeMediaTrackPickerSelection("subtitle:none")).toEqual({
    kind: "subtitle-off",
  });
});

test("applyPreferredStreamSelection prefers explicit stream id override", () => {
  const next = applyPreferredStreamSelection(
    streamWithCandidates,
    streamSelectionFromStream("stream-720"),
  );
  expect(next.url).toBe("https://cdn.example/720.m3u8");
  expect(next.audioLanguages).toEqual(["en"]);
  expect(next.hardSubLanguage).toBeUndefined();
  expect(next.providerResolveResult?.selectedStreamId).toBe("stream-720");
});

test("isCurrentStreamSelection detects no-op stream and source selections", () => {
  expect(
    isCurrentStreamSelection(streamWithCandidates, streamSelectionFromStream("stream-1080")),
  ).toBe(true);
  expect(
    isCurrentStreamSelection(streamWithCandidates, streamSelectionFromStream("stream-720")),
  ).toBe(false);
  expect(
    isCurrentStreamSelection(streamWithCandidates, streamSelectionFromSource("source-a")),
  ).toBe(true);
  expect(
    isCurrentStreamSelection(streamWithCandidates, streamSelectionFromSource("source-b")),
  ).toBe(false);
});

test("applyPreferredStreamSelection falls back to best quality in preferred source", () => {
  const next = applyPreferredStreamSelection(
    streamWithCandidates,
    streamSelectionFromSource("source-b"),
  );
  expect(next.url).toBe("https://cdn.example/source-b-480.m3u8");
  expect(next.audioLanguages).toBeUndefined();
  expect(next.hardSubLanguage).toBeUndefined();
  expect(next.providerResolveResult?.selectedStreamId).toBe("stream-480-source-b");
});

test("streamSelectionFromTrackPick maps each panel section to a restart intent", () => {
  expect(streamSelectionFromTrackPick({ section: "source", value: "source-b" })).toEqual({
    sourceId: "source-b",
    streamId: null,
  });
  expect(streamSelectionFromTrackPick({ section: "quality", value: "stream-720" })).toEqual({
    sourceId: null,
    streamId: "stream-720",
  });
  expect(streamSelectionFromTrackPick({ section: "audio", value: "stream-jp" })).toEqual({
    sourceId: null,
    streamId: "stream-jp",
  });
  expect(streamSelectionFromTrackPick({ section: "hardsub", value: "stream-en" })).toEqual({
    sourceId: null,
    streamId: "stream-en",
  });
  // Subtitles attach in mpv — no pre-play restart path.
  expect(
    streamSelectionFromTrackPick({ section: "subtitle", value: "https://x/sub.vtt" }),
  ).toBeNull();
});
