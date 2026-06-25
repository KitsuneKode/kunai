import { describe, expect, test } from "bun:test";

import { mapInvidiousSearchItem } from "@kunai/providers/youtube";

describe("mapInvidiousSearchItem", () => {
  test("maps liveNow to live badge", () => {
    const mapped = mapInvidiousSearchItem({
      type: "video",
      title: "Live stream",
      videoId: "abc123",
      author: "Channel",
      authorId: "chan1",
      liveNow: true,
      lengthSeconds: 0,
    });

    expect(mapped?.liveStatus).toBe("live");
    expect(mapped?.externalIds?.youtubeId).toBe("abc123");
  });

  test("maps scheduled premiere text to upcoming", () => {
    const mapped = mapInvidiousSearchItem({
      type: "video",
      title: "Premiere",
      videoId: "prem1",
      author: "Channel",
      authorId: "chan1",
      publishedText: "Scheduled for tomorrow",
    });

    expect(mapped?.liveStatus).toBe("upcoming");
  });
});
