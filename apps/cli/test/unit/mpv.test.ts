import { expect, test } from "bun:test";

import { buildMpvArgs, collectAdditionalSubtitleTracks } from "@/mpv";

test("buildMpvArgs only attaches the primary subtitle during initial launch", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: { referer: "https://www.vidking.net/", "user-agent": "Mozilla/5.0" },
      subtitle: "https://sub.example/en.srt",
      subtitleTracks: [{ url: "https://sub.example/ar.srt", language: "ar" }],
      displayTitle: "Friends - S01E03",
    },
    "/tmp/kunai-test.sock",
  );

  expect(args).toContain("--keep-open=no");
  expect(args).toContain("--idle=no");
  expect(args).toContain("--force-window=yes");
  expect(args).toContain("--autofit-larger=90%x90%");
  expect(args).toContain("--cache=yes");
  expect(args).toContain("--cache-pause=yes");
  expect(args).toContain("--cache-pause-wait=2");
  expect(args).toContain("--demuxer-readahead-secs=60");
  expect(args).toContain("--demuxer-max-bytes=200MiB");
  expect(args).toContain("--input-ipc-server=/tmp/kunai-test.sock");
  expect(args).toContain("--sub-file=https://sub.example/en.srt");
  expect(args).not.toContain("--sub-file=https://sub.example/ar.srt");
});

test("buildMpvArgs can defer resume seeking to IPC for persistent playback", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Frieren - S01E09",
      startAt: 128,
    },
    "/tmp/kunai-test.sock",
    { persistent: true, includeStartArg: false },
  );

  expect(args).toContain("--keep-open=no");
  expect(args).toContain("--idle=yes");
  expect(args).not.toContain("--start=128");
});

test("buildMpvArgs keeps mpv alive between files for persistent autoplay chains", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Breaking Bad - S02E05",
    },
    "/tmp/kunai-test.sock",
    { persistent: true },
  );

  expect(args).toContain("--keep-open=no");
  expect(args).toContain("--idle=yes");
});

test("collectAdditionalSubtitleTracks excludes the primary subtitle and dedupes extras", () => {
  expect(
    collectAdditionalSubtitleTracks("https://sub.example/en.srt", [
      { url: "https://sub.example/en.srt", language: "en" },
      { url: "https://sub.example/ar.srt", language: "ar" },
      { url: "https://sub.example/ar.srt", language: "ar" },
      { url: "https://sub.example/fr.srt", language: "fr" },
    ]),
  ).toEqual([
    { url: "https://sub.example/ar.srt", language: "ar" },
    { url: "https://sub.example/fr.srt", language: "fr" },
  ]);
});
