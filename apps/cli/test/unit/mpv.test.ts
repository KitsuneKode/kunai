import { expect, test } from "bun:test";

import { buildMpvArgs } from "@/mpv";

test("buildMpvArgs forces mpv to exit cleanly at eof for autoplay flows", () => {
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
  expect(args).toContain("--sub-file=https://sub.example/ar.srt");
});
