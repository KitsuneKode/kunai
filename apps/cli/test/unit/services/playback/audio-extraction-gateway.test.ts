import { expect, test } from "bun:test";

import { buildAudioExtractionArgs } from "@/services/playback/cast/audio-extraction-gateway";

test("audio extraction removes video and emits progressive MP3 to stdout", () => {
  const args = buildAudioExtractionArgs({
    url: "https://media.example/master.m3u8",
    headers: { Referer: "https://provider.example/watch", Cookie: "session=example" },
    timestamp: 1,
  });

  expect(args).toContain("-vn");
  expect(args).toContain("0:a:0");
  expect(args).toContain("libmp3lame");
  expect(args).toContain("mp3");
  expect(args.at(-1)).toBe("pipe:1");
  expect(args[args.indexOf("-headers") + 1]).toBe(
    "Referer: https://provider.example/watch\r\nCookie: session=example\r\n",
  );
});

test("audio extraction strips header control characters before spawning ffmpeg", () => {
  const args = buildAudioExtractionArgs({
    url: "https://media.example/video.mp4",
    headers: { "Bad\r\nHeader:": "one\r\ntwo" },
    timestamp: 1,
  });
  expect(args[args.indexOf("-headers") + 1]).toBe("BadHeader: one two\r\n");
});

test("audio extraction starts at the requested source position", () => {
  const args = buildAudioExtractionArgs(
    { url: "https://media.example/video.mp4", headers: {}, timestamp: 1 },
    42.5,
  );
  const inputIndex = args.indexOf("-i");
  const seekIndexes = args.flatMap((arg, index) => (arg === "-ss" ? [index] : []));
  expect(seekIndexes).toHaveLength(1);
  expect(args.slice(seekIndexes[0], (seekIndexes[0] ?? 0) + 2)).toEqual(["-ss", "42.5"]);
  expect(seekIndexes[0]).toBeLessThan(inputIndex);
});
