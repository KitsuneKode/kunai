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
    posterPath: null,
    contentShape: "video",
    externalIds: { youtubeId: "dQw4w9WgXcQ" },
  };

  const option = toBrowseResultOption(result);
  const detail = option.detail ?? "";

  expect(detail.startsWith("Video")).toBe(true);
  expect(detail.startsWith("Movie")).toBe(false);
  expect(option.previewMeta).toContain("Video");
  expect(option.previewNote).toBe("Press Enter to open this video and continue to playback.");
});

test("toBrowseResultOption explains YouTube playlists as picker flows", () => {
  const result: SearchResult = {
    id: "youtube:playlist:PL123",
    type: "movie",
    title: "Playlist",
    year: "",
    overview: "",
    posterPath: null,
    contentShape: "playlist",
    externalIds: { youtubePlaylistId: "PL123" },
  };

  const option = toBrowseResultOption(result);
  const detail = option.detail ?? "";

  expect(detail.startsWith("Playlist")).toBe(true);
  expect(option.previewNote).toBe("Press Enter to open this playlist and choose a video.");
});
