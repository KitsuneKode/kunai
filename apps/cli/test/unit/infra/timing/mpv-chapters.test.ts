import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import type { PlaybackTimingMetadata } from "@/domain/types";
import {
  buildChapterSegmentsFromTiming,
  buildFfmetadataChaptersFromTiming,
  buildOgmChaptersFromTiming,
  formatOgmTimestamp,
  removeMpvChaptersFile,
  writeMpvChaptersFile,
} from "@/infra/timing";

test("formatOgmTimestamp correctly formats milliseconds to OGM HH:MM:SS.mmm format", () => {
  expect(formatOgmTimestamp(0)).toBe("00:00:00.000");
  expect(formatOgmTimestamp(1500)).toBe("00:00:01.500");
  expect(formatOgmTimestamp(90_000)).toBe("00:01:30.000");
  expect(formatOgmTimestamp(3_661_250)).toBe("01:01:01.250");
});

test("buildChapterSegmentsFromTiming returns empty for null/empty timing", () => {
  expect(buildChapterSegmentsFromTiming(null)).toEqual([]);
  expect(buildChapterSegmentsFromTiming(undefined)).toEqual([]);
  expect(
    buildChapterSegmentsFromTiming({
      tmdbId: "123",
      type: "series",
      intro: [],
      credits: [],
      recap: [],
      preview: [],
    }),
  ).toEqual([]);
});

test("buildChapterSegmentsFromTiming builds continuous Prologue -> Intro -> Episode -> Credits -> Epilogue segments", () => {
  const timing: PlaybackTimingMetadata = {
    tmdbId: "123",
    type: "series",
    intro: [{ startMs: 90_000, endMs: 180_000 }],
    credits: [{ startMs: 1_320_000, endMs: 1_410_000 }],
    recap: [],
    preview: [],
  };

  const segments = buildChapterSegmentsFromTiming(timing);
  expect(segments).toHaveLength(5);
  expect(segments[0]).toEqual({ startMs: 0, endMs: 90_000, title: "Prologue" });
  expect(segments[1]).toEqual({ startMs: 90_000, endMs: 180_000, title: "Intro" });
  expect(segments[2]).toEqual({ startMs: 180_000, endMs: 1_320_000, title: "Episode" });
  expect(segments[3]).toEqual({ startMs: 1_320_000, endMs: 1_410_000, title: "Credits" });
  expect(segments[4]?.title).toBe("Epilogue");
});

test("buildFfmetadataChaptersFromTiming generates valid FFMETADATA1 syntax", () => {
  const timing: PlaybackTimingMetadata = {
    tmdbId: "123",
    type: "series",
    intro: [{ startMs: 90_000, endMs: 180_000 }],
    credits: [{ startMs: 1_320_000, endMs: 1_410_000 }],
    recap: [],
    preview: [],
  };

  const meta = buildFfmetadataChaptersFromTiming(timing);
  expect(meta).not.toBeNull();
  expect(meta).toContain(";FFMETADATA1");
  expect(meta).toContain("[CHAPTER]");
  expect(meta).toContain("TIMEBASE=1/1000");
  expect(meta).toContain("START=0\nEND=90000\ntitle=Prologue");
  expect(meta).toContain("START=90000\nEND=180000\ntitle=Intro");
  expect(meta).toContain("START=180000\nEND=1320000\ntitle=Episode");
  expect(meta).toContain("START=1320000\nEND=1410000\ntitle=Credits");
});

test("buildOgmChaptersFromTiming generates ordered OGM chapters for anime segments", () => {
  const timing: PlaybackTimingMetadata = {
    tmdbId: "123",
    type: "series",
    intro: [{ startMs: 90_000, endMs: 180_000 }],
    credits: [{ startMs: 1_320_000, endMs: 1_410_000 }],
    recap: [],
    preview: [],
  };

  const ogm = buildOgmChaptersFromTiming(timing);
  expect(ogm).not.toBeNull();
  expect(ogm).toContain("CHAPTER01=00:00:00.000\nCHAPTER01NAME=Prologue");
  expect(ogm).toContain("CHAPTER02=00:01:30.000\nCHAPTER02NAME=Intro");
  expect(ogm).toContain("CHAPTER03=00:03:00.000\nCHAPTER03NAME=Episode");
  expect(ogm).toContain("CHAPTER04=00:22:00.000\nCHAPTER04NAME=Credits");
  expect(ogm).toContain("CHAPTER05=00:23:30.000\nCHAPTER05NAME=Epilogue");
});

test("writeMpvChaptersFile and removeMpvChaptersFile manage chapter files correctly", async () => {
  const timing: PlaybackTimingMetadata = {
    tmdbId: "456",
    type: "series",
    intro: [{ startMs: 60_000, endMs: 150_000 }],
    credits: [],
    recap: [],
    preview: [],
  };

  const id = `test-${Date.now()}`;
  const filePath = await writeMpvChaptersFile(timing, id);
  expect(filePath).not.toBeNull();
  expect(filePath).toContain(`kunai-chapters-${id}.ffmeta`);

  expect(existsSync(filePath!)).toBe(true);

  await removeMpvChaptersFile(filePath);
  expect(existsSync(filePath!)).toBe(false);
});
