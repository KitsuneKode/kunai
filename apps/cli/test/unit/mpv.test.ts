import { expect, test } from "bun:test";

import { buildMpvArgs, collectAdditionalSubtitleUrls } from "@/mpv";

test("buildMpvArgs only attaches the primary subtitle during initial launch", () => {
  const args = buildMpvArgs(
    {
      url: "https://cdn.example/master.m3u8",
      headers: { referer: "https://www.vidking.net/", "user-agent": "Mozilla/5.0" },
      subtitle: "https://sub.example/en.srt",
      subtitleUrls: ["https://sub.example/ar.srt"],
      displayTitle: "Friends - S01E03",
    },
    "/tmp/kunai-test.sock",
  );

  expect(args).toContain("--keep-open=no");
  expect(args).toContain("--idle=no");
  expect(args).toContain("--force-window=no");
  expect(args).toContain("--input-ipc-server=/tmp/kunai-test.sock");
  expect(args).toContain("--sub-file=https://sub.example/en.srt");
  expect(args).not.toContain("--sub-file=https://sub.example/ar.srt");
});

test("collectAdditionalSubtitleUrls excludes the primary subtitle and dedupes extras", () => {
  expect(
    collectAdditionalSubtitleUrls("https://sub.example/en.srt", [
      "https://sub.example/en.srt",
      "https://sub.example/ar.srt",
      "https://sub.example/ar.srt",
      "https://sub.example/fr.srt",
    ]),
  ).toEqual(["https://sub.example/ar.srt", "https://sub.example/fr.srt"]);
});
