import { describe, expect, test } from "bun:test";

import {
  decodePlaybackTargetWebCode,
  encodePlaybackTargetRef,
  encodePlaybackTargetShortCode,
  encodePlaybackTargetWebUrl,
  parseKunaiShareUrl,
  parsePlaybackTargetRef,
  type PlaybackTargetRef,
} from "../src";

describe("web share codec", () => {
  const seriesRef: PlaybackTargetRef = {
    anchor: { by: "catalog", ns: "tmdb", id: "1396" },
    kind: "series",
    season: 1,
    episode: 3,
    startSeconds: 83,
    title: "Breaking Bad",
    hint: { providerId: "videasy", quality: "1080p" },
  };
  const sampleRefs: readonly PlaybackTargetRef[] = [
    seriesRef,
    {
      anchor: { by: "catalog", ns: "anilist", id: "21" },
      kind: "anime",
      season: 1,
      episode: 1,
      absoluteEpisode: 1075,
      startSeconds: 120,
      title: "One Piece",
    },
    {
      anchor: { by: "search", query: "Cowboy Bebop" },
      kind: "anime",
      title: "Cowboy Bebop",
    },
  ];

  test.each([...sampleRefs])("round-trips every playback ref shape through HTTPS", (ref) => {
    const webUrl = encodePlaybackTargetWebUrl(ref);

    expect(webUrl).toStartWith("https://kunai.kitsunekode.in/w/v1.");
    expect(parsePlaybackTargetRef(webUrl)).toEqual(ref);
    expect(parseKunaiShareUrl(webUrl)).toEqual({ action: "play", ref });
  });

  test("preserves the download action", () => {
    const ref = seriesRef;
    const webUrl = encodePlaybackTargetWebUrl(ref, "download");

    expect(parseKunaiShareUrl(webUrl)).toEqual({ action: "download", ref });
  });

  test("carries a safe optional poster without changing the playback ref", () => {
    const ref = seriesRef;
    const webUrl = encodePlaybackTargetWebUrl(ref, "play", {
      posterUrl: "https://image.tmdb.org/t/p/w500/example.jpg",
    });

    expect(parseKunaiShareUrl(webUrl)).toEqual({
      action: "play",
      ref,
      presentation: { posterUrl: "https://image.tmdb.org/t/p/w500/example.jpg" },
    });
    expect(parsePlaybackTargetRef(webUrl)).toEqual(ref);
  });

  test("accepts compact codes inside the HTTPS landing path", () => {
    const ref: PlaybackTargetRef = {
      anchor: { by: "catalog", ns: "tmdb", id: "1396" },
      kind: "series",
      season: 1,
      episode: 3,
    };
    const code = encodePlaybackTargetShortCode(ref);

    expect(code).not.toBeNull();
    expect(parseKunaiShareUrl(`https://kunai.kitsunekode.in/w/${code}`)).toEqual({
      action: "play",
      ref,
    });
  });

  test("drops an oversized optional poster instead of minting a self-invalid link", () => {
    const ref = seriesRef;
    const webUrl = encodePlaybackTargetWebUrl(ref, "play", {
      posterUrl: `https://example.com/${"ü".repeat(1_000)}`,
    });

    expect(parseKunaiShareUrl(webUrl)).toEqual({ action: "play", ref });
  });

  test("rejects malformed, truncated, foreign-origin, and oversized web codes", () => {
    const url = new URL(encodePlaybackTargetWebUrl(seriesRef));
    const code = url.pathname.split("/").at(-1) ?? "";

    expect(decodePlaybackTargetWebCode(code.slice(0, -2))).toBeNull();
    expect(parsePlaybackTargetRef(`https://example.com/w/${code}`)).toBeNull();
    expect(parsePlaybackTargetRef("https://kunai.kitsunekode.in/w/v1.***")).toBeNull();
    expect(decodePlaybackTargetWebCode(`v1.${"A".repeat(4_097)}`)).toBeNull();
  });
});

describe("compact catalog share codes", () => {
  test("is equivalent to the canonical long series ref and stays speakable", () => {
    const ref: PlaybackTargetRef = {
      anchor: { by: "catalog", ns: "tmdb", id: "1396" },
      kind: "series",
      season: 1,
      episode: 3,
      startSeconds: 83,
    };
    const short = encodePlaybackTargetShortCode(ref);

    expect(short).not.toBeNull();
    expect(short?.length).toBeLessThan(40);
    expect(parsePlaybackTargetRef(short ?? "")).toEqual(ref);
    expect(parsePlaybackTargetRef(short ?? "")).toEqual(
      parsePlaybackTargetRef(encodePlaybackTargetRef(ref)),
    );
  });

  test("round-trips anime absolute identity, timestamp, title, and source hints", () => {
    const ref: PlaybackTargetRef = {
      anchor: { by: "catalog", ns: "anilist", id: "21" },
      kind: "anime",
      season: 1,
      episode: 1,
      absoluteEpisode: 1075,
      startSeconds: 120,
      title: "One Piece",
      hint: { providerId: "allanime", quality: "1080p" },
    };
    const short = encodePlaybackTargetShortCode(ref, "download");

    expect(short).not.toBeNull();
    expect(parsePlaybackTargetRef(short ?? "")).toEqual(ref);
    expect(parseKunaiShareUrl(short ?? "")).toEqual({ action: "download", ref });
  });

  test("does not pretend a search anchor is a catalog short code", () => {
    expect(
      encodePlaybackTargetShortCode({
        anchor: { by: "search", query: "One Piece" },
        kind: "anime",
      }),
    ).toBeNull();
  });

  test("rejects damaged compact fields instead of partially parsing them", () => {
    expect(parsePlaybackTargetRef("k1pts.bad.1.nope")).toBeNull();
    expect(parsePlaybackTargetRef("k1zzz.MTM5Ng")).toBeNull();
    expect(parsePlaybackTargetRef(`k1${"a".repeat(2_048)}`)).toBeNull();
  });
});
