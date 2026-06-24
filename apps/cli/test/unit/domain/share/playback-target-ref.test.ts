import { describe, expect, it } from "bun:test";

import {
  encodePlaybackTargetRef,
  formatSecondsForUrl,
  parseKunaiShareUrl,
  parsePlaybackTargetRef,
  parseTimestampToSeconds,
  type PlaybackTargetRef,
} from "@/domain/share/playback-target-ref";

describe("parseTimestampToSeconds", () => {
  it("parses raw seconds", () => expect(parseTimestampToSeconds("83")).toBe(83));
  it("parses 1m23s", () => expect(parseTimestampToSeconds("1m23s")).toBe(83));
  it("parses 1:23", () => expect(parseTimestampToSeconds("1:23")).toBe(83));
  it("parses 1:02:03", () => expect(parseTimestampToSeconds("1:02:03")).toBe(3723));
  it("rejects junk", () => expect(parseTimestampToSeconds("abc")).toBeNull());
  it("rejects negative", () => expect(parseTimestampToSeconds("-5")).toBeNull());
});

describe("formatSecondsForUrl", () => {
  it("formats seconds plainly", () => expect(formatSecondsForUrl(83)).toBe("83"));
});

describe("playback target ref codec", () => {
  const animeRef: PlaybackTargetRef = {
    anchor: { by: "catalog", ns: "anilist", id: "21" },
    kind: "anime",
    absoluteEpisode: 1075,
    startSeconds: 83,
    hint: { providerId: "allanime" },
  };

  it("round-trips an anime ref with timestamp and hint", () => {
    const url = encodePlaybackTargetRef(animeRef);
    expect(url).toBe("kunai://play?cat=anilist%3A21&kind=anime&abs=1075&t=83&src=allanime");
    expect(parsePlaybackTargetRef(url)).toEqual(animeRef);
  });

  it("round-trips series season and episode", () => {
    const ref: PlaybackTargetRef = {
      anchor: { by: "catalog", ns: "tmdb", id: "1399" },
      kind: "series",
      season: 2,
      episode: 5,
    };
    expect(parsePlaybackTargetRef(encodePlaybackTargetRef(ref))).toEqual(ref);
  });

  it("parses human-readable timestamps", () => {
    const ref = parsePlaybackTargetRef("kunai://play?cat=tmdb:1399&kind=series&s=2&e=5&t=1m23s");
    expect(ref?.startSeconds).toBe(83);
  });

  it("parses download action URLs", () => {
    const parsed = parseKunaiShareUrl("kunai://download?cat=tmdb:99&kind=movie");
    expect(parsed?.action).toBe("download");
    expect(parsed?.ref.anchor).toEqual({ by: "catalog", ns: "tmdb", id: "99" });
  });

  it("rejects URLs without cat or q anchor", () => {
    expect(parsePlaybackTargetRef("kunai://play?kind=series")).toBeNull();
    expect(parsePlaybackTargetRef("https://example.com")).toBeNull();
    expect(parsePlaybackTargetRef("kunai://play?cat=bad:1&kind=series")).toBeNull();
    expect(parsePlaybackTargetRef("kunai://play?cat=tmdb:&kind=series")).toBeNull();
    expect(parsePlaybackTargetRef("kunai://play?cat=:1399&kind=series")).toBeNull();
  });

  it("round-trips search anchors and title labels", () => {
    const ref: PlaybackTargetRef = {
      anchor: { by: "search", query: "cowboy bebop" },
      kind: "anime",
      title: "Cowboy Bebop",
    };
    const url = encodePlaybackTargetRef(ref);
    expect(url).toBe("kunai://play?q=cowboy%20bebop&kind=anime&n=Cowboy%20Bebop");
    expect(parsePlaybackTargetRef(url)).toEqual(ref);
  });

  it("defaults kind to series when omitted", () => {
    const ref = parsePlaybackTargetRef("kunai://play?cat=tmdb:99&q=ignored");
    expect(ref?.kind).toBe("series");
    expect(ref?.anchor).toEqual({ by: "catalog", ns: "tmdb", id: "99" });
  });

  it("rejects empty search queries", () => {
    expect(parsePlaybackTargetRef("kunai://play?q=&kind=anime")).toBeNull();
  });
});
