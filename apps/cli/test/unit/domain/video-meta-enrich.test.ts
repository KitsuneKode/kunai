import { describe, expect, test } from "bun:test";

import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";

describe("enrichExternalIdsWithVideoMeta", () => {
  test("adds youtubeChannelId from videoMeta when missing", () => {
    expect(
      enrichExternalIdsWithVideoMeta({ youtubeId: "abc" }, { channelId: "UCchannel" }),
    ).toEqual({
      youtubeId: "abc",
      youtubeChannelId: "UCchannel",
    });
  });

  test("keeps an existing youtubeChannelId", () => {
    expect(
      enrichExternalIdsWithVideoMeta(
        { youtubeId: "abc", youtubeChannelId: "UCkeep" },
        { channelId: "UCother" },
      ),
    ).toEqual({
      youtubeId: "abc",
      youtubeChannelId: "UCkeep",
    });
  });

  test("returns existing when videoMeta has no channel", () => {
    expect(enrichExternalIdsWithVideoMeta({ youtubeId: "abc" }, { channelTitle: "X" })).toEqual({
      youtubeId: "abc",
    });
  });
});
