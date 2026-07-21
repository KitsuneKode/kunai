import { expect, test } from "bun:test";

import { toBrowseResultOption } from "@/app/search/browse-option-mappers";
import type { SearchResult } from "@/domain/types";

test("toBrowseResultOption labels YouTube videos by content shape, not transport type", () => {
  const result: SearchResult = {
    id: "youtube:dQw4w9WgXcQ",
    type: "movie",
    title: "Never Gonna Give You Up",
    year: "2009",
    overview: "",
    posterPath: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    contentShape: "video",
    channelTitle: "Rick Astley",
    channelId: "UCuAXFkgsw1L7NyaFkawy4LQ",
    externalIds: {
      youtubeId: "dQw4w9WgXcQ",
      youtubeChannelId: "UCuAXFkgsw1L7NyaFkawy4LQ",
    },
  };

  const option = toBrowseResultOption(result);
  const detail = option.detail ?? "";

  expect(detail.startsWith("Video")).toBe(true);
  expect(detail.startsWith("Movie")).toBe(false);
  expect(option.previewMeta).toContain("Video");
  expect(option.previewMeta).toContain("Rick Astley");
  expect(option.previewImageUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  expect(option.previewNote).toBe("Press Enter to open this video and continue to playback.");
});

test("toBrowseResultOption explains YouTube playlists as picker flows", () => {
  const result: SearchResult = {
    id: "youtube-playlist:PL123",
    type: "series",
    title: "Playlist",
    year: "",
    overview: "",
    posterPath: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
    contentShape: "playlist",
    externalIds: { youtubePlaylistId: "PL123" },
  };

  const option = toBrowseResultOption(result);
  const detail = option.detail ?? "";

  expect(detail.startsWith("Playlist")).toBe(true);
  expect(option.previewImageUrl).toBe("https://i.ytimg.com/vi/abc/mqdefault.jpg");
  expect(option.previewNote).toBe("Press Enter to open this playlist and choose a video.");
});

test("toBrowseResultOption labels channels with avatar poster and video count", () => {
  const result: SearchResult = {
    id: "youtube-channel:UCchannel",
    type: "series",
    title: "Example Channel",
    year: "",
    overview: "Channel bio",
    posterPath: "https://yt3.ggpht.com/avatar.jpg",
    contentShape: "channel",
    episodeCount: 120,
    channelTitle: "Example Channel",
    channelId: "UCchannel",
    externalIds: { youtubeChannelId: "UCchannel" },
  };

  const option = toBrowseResultOption(result);
  expect(option.detail?.startsWith("Channel")).toBe(true);
  expect(option.previewMeta).toContain("Channel");
  expect(option.previewMeta).toContain("120 videos");
  expect(option.previewImageUrl).toBe("https://yt3.ggpht.com/avatar.jpg");
  expect(option.previewNote).toBe("Press Enter to open this channel and choose a video.");
});
