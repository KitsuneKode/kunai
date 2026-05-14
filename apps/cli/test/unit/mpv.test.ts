import { expect, test } from "bun:test";

import {
  buildMpvArgs,
  collectAdditionalSubtitleTracks,
  collectLaunchSubtitleFiles,
  describeSubtitleTrackForMpv,
  shouldApplyStartAtSeek,
} from "@/mpv";

test("buildMpvArgs attaches preferred subtitle first plus additional tracks during initial launch", () => {
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
  expect(args).toContain("--force-window=immediate");
  expect(args).toContain("--resume-playback=no");
  expect(args).toContain("--autofit-larger=90%x90%");
  expect(args).toContain("--cache=yes");
  expect(args).toContain("--cache-pause=yes");
  expect(args).toContain("--cache-pause-wait=2");
  expect(args).toContain("--demuxer-readahead-secs=60");
  expect(args).toContain("--demuxer-max-bytes=200MiB");
  expect(args).toContain("--input-ipc-server=/tmp/kunai-test.sock");
  expect(args.filter((arg) => arg.startsWith("--sub-file="))).toEqual([
    "--sub-file=https://sub.example/en.srt",
    "--sub-file=https://sub.example/ar.srt",
  ]);
});

test("buildMpvArgs passes --script-opts when scriptOpts is set", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Test",
    },
    "/tmp/kunai-test.sock",
    { scriptOpts: "kunai-bridge-margin_bottom=130" },
  );
  expect(args).toContain("--script-opts=kunai-bridge-margin_bottom=130");
});

test("shouldApplyStartAtSeek is true for small resume offsets", () => {
  expect(shouldApplyStartAtSeek(3)).toBe(true);
  expect(shouldApplyStartAtSeek(0.5)).toBe(true);
  expect(shouldApplyStartAtSeek(undefined)).toBe(false);
  expect(shouldApplyStartAtSeek(0)).toBe(false);
});

test("buildMpvArgs passes --start for small offsets when includeStartArg is true", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Test",
      startAt: 4,
    },
    "/tmp/kunai-test.sock",
    { includeStartArg: true },
  );
  expect(args).toContain("--start=4");
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
  expect(args).toContain("--resume-playback=no");
  expect(args).not.toContain("--start=128");
});

test("buildMpvArgs suppresses launch --start by default for persistent playback", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Friends - S01E09",
      startAt: 562,
    },
    "/tmp/kunai-test.sock",
    { persistent: true },
  );

  expect(args).toContain("--idle=yes");
  expect(args).not.toContain("--start=562");
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

test("buildMpvArgs maps language preferences to mpv alang/slang", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      audioPreference: "original",
      subtitlePreference: "none",
      displayTitle: "Language wiring",
    },
    "/tmp/kunai-test.sock",
  );

  expect(args).toContain("--alang=orig");
  expect(args).toContain("--slang=no");
});

test("buildMpvArgs skips slang for interactive subtitle mode", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      audioPreference: "ja",
      subtitlePreference: "interactive",
      displayTitle: "Interactive subtitle picker",
    },
    "/tmp/kunai-test.sock",
  );

  expect(args).toContain("--alang=ja");
  expect(args.some((arg) => arg.startsWith("--slang="))).toBe(false);
});

test("buildMpvArgs keeps legacy fzf subtitle mode compatibility without slang", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      subtitle: null,
      subtitlePreference: "fzf",
      displayTitle: "Legacy subtitle mode compatibility",
    },
    "/tmp/kunai-test.sock",
  );

  expect(args.some((arg) => arg.startsWith("--slang="))).toBe(false);
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

test("collectAdditionalSubtitleTracks dedupes equivalent subtitle URLs with query churn", () => {
  expect(
    collectAdditionalSubtitleTracks("https://sub.example/en.vtt?q=first", [
      { url: "https://sub.example/en.vtt?q=second", language: "en" },
      { url: "https://sub.example/fr.vtt?q=first", language: "fr" },
      { url: "https://sub.example/fr.vtt?q=second", language: "fr" },
    ]),
  ).toEqual([{ url: "https://sub.example/fr.vtt?q=first", language: "fr" }]);
});

test("collectLaunchSubtitleFiles keeps the selected subtitle first and dedupes inventory", () => {
  expect(
    collectLaunchSubtitleFiles("https://sub.example/en.vtt?q=selected", [
      { url: "https://sub.example/ar.vtt", language: "ar" },
      { url: "https://sub.example/en.vtt?q=alternate", language: "en" },
      { url: "https://sub.example/fr.vtt", language: "fr" },
      { url: "https://sub.example/fr.vtt", language: "fr" },
    ]),
  ).toEqual([
    "https://sub.example/en.vtt?q=selected",
    "https://sub.example/ar.vtt",
    "https://sub.example/fr.vtt",
  ]);
});

test("describeSubtitleTrackForMpv names selected subtitle tracks from inventory", () => {
  expect(
    describeSubtitleTrackForMpv("https://sub.example/en.vtt?q=selected", [
      {
        url: "https://sub.example/en.vtt?q=inventory",
        language: "en",
        display: "English SDH",
        sourceName: "wyzie",
        sourceKind: "external",
      },
    ]),
  ).toEqual({ title: "English SDH", language: "en" });
});
