import { expect, test } from "bun:test";

import { convertSubtitleToWebVtt } from "@/services/playback/cast/cast-subtitle-gateway";

test("converts SRT cues into receiver-compatible WebVTT", () => {
  expect(convertSubtitleToWebVtt("1\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\n")).toBe(
    "WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nHello\n",
  );
});

test("preserves existing WebVTT", () => {
  const source = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n";
  expect(convertSubtitleToWebVtt(source)).toBe(source);
});

test("converts basic ASS dialogue and strips styling tags", () => {
  const source = `[Script Info]\n[Events]\nDialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,{\\i1}Hello\\Nworld`;
  expect(convertSubtitleToWebVtt(source)).toBe(
    "WEBVTT\n\n00:00:01.200 --> 00:00:03.400\nHello\nworld\n",
  );
});
