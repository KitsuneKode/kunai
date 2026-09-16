import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import type { PlaybackTimingMetadata } from "@/domain/types";
import {
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

test("buildOgmChaptersFromTiming returns null for empty or null timing", () => {
  expect(buildOgmChaptersFromTiming(null)).toBeNull();
  expect(buildOgmChaptersFromTiming(undefined)).toBeNull();
  expect(
    buildOgmChaptersFromTiming({
      tmdbId: "123",
      type: "series",
      intro: [],
      credits: [],
      recap: [],
      preview: [],
    }),
  ).toBeNull();
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
  expect(filePath).toContain(`kunai-chapters-${id}.ogm`);

  expect(existsSync(filePath!)).toBe(true);

  await removeMpvChaptersFile(filePath);
  expect(existsSync(filePath!)).toBe(false);
});
