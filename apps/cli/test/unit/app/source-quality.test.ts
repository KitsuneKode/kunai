import { expect, test } from "bun:test";

import {
  applyPreferredStreamSelection,
  buildQualityPickerOptions,
  buildSourcePickerOptions,
  buildStreamPickerOptions,
  isCurrentStreamSelection,
  streamSelectionFromSource,
  streamSelectionFromStream,
} from "@/app/source-quality";
import type { StreamInfo } from "@/domain/types";

const streamWithCandidates: StreamInfo = {
  url: "https://cdn.example/1080.m3u8",
  headers: { referer: "https://example.com" },
  timestamp: Date.now(),
  providerResolveResult: {
    providerId: "vidking",
    selectedStreamId: "stream-1080",
    streams: [
      {
        id: "stream-1080",
        providerId: "vidking",
        sourceId: "source-a",
        protocol: "hls",
        container: "m3u8",
        audioLanguage: "ja",
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
        audioLanguage: "en",
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
      candidate.id === "stream-1080" ? { ...candidate, variantId: "variant-1080" } : candidate,
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
  expect(options[0]?.detail).toBe("hls  ·  m3u8  ·  audio ja  ·  hardsub en");
  expect(options[1]?.detail).toBe("hls  ·  m3u8  ·  audio en");
});

test("buildQualityPickerOptions shows soft subtitles linked to the selected variant", () => {
  const options = buildQualityPickerOptions(streamWithSubtitles);
  expect(options[0]?.detail).toBe("hls  ·  m3u8  ·  audio ja  ·  hardsub en  ·  soft subs en");
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

test("applyPreferredStreamSelection prefers explicit stream id override", () => {
  const next = applyPreferredStreamSelection(
    streamWithCandidates,
    streamSelectionFromStream("stream-720"),
  );
  expect(next.url).toBe("https://cdn.example/720.m3u8");
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
  expect(next.providerResolveResult?.selectedStreamId).toBe("stream-480-source-b");
});
