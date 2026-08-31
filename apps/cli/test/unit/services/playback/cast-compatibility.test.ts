import { describe, expect, test } from "bun:test";

import type { StreamInfo } from "@/domain/types";
import { assessDirectCastCompatibility } from "@/services/playback/cast/cast-compatibility";

const stream = (url: string, headers: Record<string, string> = {}): StreamInfo => ({
  url,
  headers,
  timestamp: 1,
});

describe("direct Cast compatibility", () => {
  test("maps direct HLS, DASH, MP4, WebM, and MP3 media types", () => {
    expect(assessDirectCastCompatibility(stream("https://media.test/master.m3u8"))).toEqual({
      kind: "direct",
      contentType: "application/x-mpegURL",
    });
    expect(assessDirectCastCompatibility(stream("https://media.test/manifest.mpd"))).toEqual({
      kind: "direct",
      contentType: "application/dash+xml",
    });
    expect(assessDirectCastCompatibility(stream("https://media.test/movie.mp4"))).toEqual({
      kind: "direct",
      contentType: "video/mp4",
    });
    expect(assessDirectCastCompatibility(stream("https://media.test/movie.webm"))).toEqual({
      kind: "direct",
      contentType: "video/webm",
    });
    expect(assessDirectCastCompatibility(stream("https://media.test/audio.mp3"))).toEqual({
      kind: "direct",
      contentType: "audio/mpeg",
    });
  });

  test("routes protected and local streams to the future gateway", () => {
    expect(
      assessDirectCastCompatibility(
        stream("https://media.test/master.m3u8", { Referer: "https://provider.test" }),
      ),
    ).toEqual({ kind: "gateway-required", reasons: ["headers"] });
    expect(assessDirectCastCompatibility(stream("/tmp/episode.mkv"))).toEqual({
      kind: "gateway-required",
      reasons: ["local-file"],
    });
  });
});
