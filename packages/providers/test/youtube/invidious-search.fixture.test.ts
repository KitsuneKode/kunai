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

  test("premiere text decides upcoming by tense, not by substring", () => {
    // The published line is the last-resort signal, and tense is the whole of it.
    // Matching "premiere" as a substring also matches "Premiered 2 years ago", which
    // put an ordinary years-old video behind a "this has not started yet" notice and
    // refused to play it.
    const item = (publishedText: string) =>
      mapInvidiousSearchItem({
        type: "video",
        title: "Premiere",
        videoId: "prem1",
        author: "Channel",
        authorId: "chan1",
        publishedText,
      })?.liveStatus;

    expect(item("Premieres in 2 hours")).toBe("upcoming");
    expect(item("Premieres 8/15/2026")).toBe("upcoming");
    expect(item("Premiere")).toBe("upcoming");
    // Already happened: an ordinary video that began life as a premiere.
    expect(item("Premiered 2 years ago")).toBe("none");
    expect(item("Premiered 3 days ago")).toBe("none");
  });

  test("an explicit liveStatus always outranks the published text", () => {
    const mapped = mapInvidiousSearchItem({
      type: "video",
      title: "Finished premiere",
      videoId: "prem2",
      author: "Channel",
      authorId: "chan1",
      liveStatus: "post_live",
      publishedText: "Premieres in 2 hours",
    });

    expect(mapped?.liveStatus).toBe("post_live");
  });

  test("uses explicit Shorts metadata when an Invidious fork provides it", () => {
    const mapped = mapInvidiousSearchItem({
      type: "video",
      title: "Quick clip",
      videoId: "short1",
      author: "Channel",
      authorId: "chan1",
      isShort: true,
    });

    expect(mapped?.contentShape).toBe("short");
  });
});
