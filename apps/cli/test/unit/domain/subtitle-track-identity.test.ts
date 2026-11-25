import { describe, expect, test } from "bun:test";

import { findSubtitleInventoryTrack, subtitleTrackKey } from "@/domain/subtitle-track-identity";

const EN = { url: "https://www.youtube.com/api/timedtext?v=abc&lang=en", language: "en" };
const FR = { url: "https://www.youtube.com/api/timedtext?v=abc&lang=fr", language: "fr" };

describe("subtitleTrackKey", () => {
  test("ignores token churn within one language", () => {
    expect(subtitleTrackKey({ url: "https://cdn.example/en.vtt?t=1#a", language: "en" })).toBe(
      subtitleTrackKey({ url: "https://cdn.example/en.vtt?t=2", language: " EN " }),
    );
  });

  test("separates same-path tracks in different languages", () => {
    expect(subtitleTrackKey(EN)).not.toBe(subtitleTrackKey(FR));
  });

  test("separates query-distinct tracks whose language is unknown", () => {
    expect(subtitleTrackKey({ url: `${EN.url}&kind=asr` })).not.toBe(
      subtitleTrackKey({ url: EN.url }),
    );
    expect(subtitleTrackKey({ url: EN.url })).toBe(subtitleTrackKey({ url: ` ${EN.url} ` }));
  });

  test("has no key for an empty URL", () => {
    expect(subtitleTrackKey({ url: "  " })).toBeUndefined();
  });
});

describe("findSubtitleInventoryTrack", () => {
  test("resolves the exact URL among query-distinct languages", () => {
    // The download sidecar labels its file from this match; a path-only match
    // named a French download "en".
    expect(findSubtitleInventoryTrack(FR.url, [EN, FR])?.language).toBe("fr");
  });

  test("resolves a re-signed URL to the one same-language entry", () => {
    expect(
      findSubtitleInventoryTrack("https://cdn.example/en.vtt?t=selected", [
        { url: "https://cdn.example/en.vtt?t=inventory", language: "en" },
      ])?.language,
    ).toBe("en");
  });

  test("refuses to guess when same-path candidates disagree on language", () => {
    expect(
      findSubtitleInventoryTrack("https://www.youtube.com/api/timedtext?v=abc&lang=de", [EN, FR]),
    ).toBeUndefined();
  });
});
