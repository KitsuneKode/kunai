import { describe, expect, test } from "bun:test";

import {
  getEpisodeIdentityKey,
  getMediaItemKey,
  type MediaItemIdentity,
} from "@/domain/media/media-item-identity";

const BASE: MediaItemIdentity = {
  mediaKind: "anime",
  titleId: "t-1",
  title: "Frieren",
  season: 1,
  episode: 6,
};

describe("getEpisodeIdentityKey", () => {
  const withSource: MediaItemIdentity = { ...BASE, sourceId: "allanime" };
  const withoutSource: MediaItemIdentity = { ...BASE, sourceId: undefined };

  test("ignores the source a title would be played from", () => {
    // This is the whole reason the function exists. Queue rows do not persist
    // sourceId, so a notification that knows its source must still match the
    // queue entry for the same episode.
    expect(getEpisodeIdentityKey(withSource)).toBe(getEpisodeIdentityKey(withoutSource));
  });

  test("getMediaItemKey does NOT have that property", () => {
    // Guards against someone "simplifying" the two back into one.
    expect(getMediaItemKey(withSource)).not.toBe(getMediaItemKey(withoutSource));
  });

  test("separates episodes, seasons, titles, and kinds", () => {
    const key = getEpisodeIdentityKey(BASE);
    expect(getEpisodeIdentityKey({ ...BASE, episode: 7 })).not.toBe(key);
    expect(getEpisodeIdentityKey({ ...BASE, season: 2 })).not.toBe(key);
    expect(getEpisodeIdentityKey({ ...BASE, titleId: "t-2" })).not.toBe(key);
    expect(getEpisodeIdentityKey({ ...BASE, mediaKind: "series" })).not.toBe(key);
  });

  test("an explicit episode wins over an absolute one in the same slot", () => {
    // Both numbering schemes share a slot, so a queue entry recorded with only
    // an absolute number still matches a notification carrying the same.
    const absoluteOnly: MediaItemIdentity = {
      mediaKind: "anime",
      titleId: "t-1",
      title: "Frieren",
      absoluteEpisode: 6,
    };
    expect(getEpisodeIdentityKey(absoluteOnly)).toBe("anime:t-1:-:6");
    // BASE is episode 6 of season 1, so the season keeps them distinct.
    expect(getEpisodeIdentityKey(absoluteOnly)).not.toBe(getEpisodeIdentityKey(BASE));
  });

  test("a movie with no episode numbering is still a stable key", () => {
    const movie: MediaItemIdentity = { mediaKind: "movie", titleId: "m-1", title: "Dune" };
    const other: MediaItemIdentity = { ...movie, titleId: "m-2" };
    expect(getEpisodeIdentityKey(movie)).toBe("movie:m-1:-:-");
    expect(getEpisodeIdentityKey(movie)).not.toBe(getEpisodeIdentityKey(other));
  });
});
