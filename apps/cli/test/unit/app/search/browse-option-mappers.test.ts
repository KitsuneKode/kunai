import { expect, test } from "bun:test";

import { toBrowseResultOption } from "@/app/search/browse-option-mappers";
import type { ListService } from "@/domain/lists/ListService";
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

test("toBrowseResultOption labels AniList films as Anime even without isAnime", () => {
  const result: SearchResult = {
    id: "181053",
    type: "movie",
    title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
    year: "2025",
    overview: "",
    posterPath: null,
    durationSeconds: 9300,
    externalIds: { anilistId: "181053" },
  };

  const option = toBrowseResultOption(result);
  expect(option.detail?.startsWith("Anime")).toBe(true);
  expect(option.detail?.startsWith("Movie")).toBe(false);
  expect(option.previewMeta).toContain("Anime");
  expect(option.previewMeta?.some((item) => /episodes/i.test(item))).toBe(false);
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

function youtubeLiveResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "youtube:liveid",
    type: "movie",
    title: "Live right now",
    year: "2026",
    overview: "",
    posterPath: null,
    contentShape: "video",
    liveStatus: "live",
    channelTitle: "A Channel",
    externalIds: { youtubeId: "liveid" },
    ...overrides,
  };
}

test("a watchlisted live broadcast keeps the exact 'wl' badge", () => {
  // previewBadge is not free-form: calendarPriorityBand, the calendar episode-code
  // slot, and the preview rail all compare it to the literal "wl". Ranking a live
  // label above membership silently drops watchlisted items out of all three.
  const listService = {
    isInWatchlist: () => true,
    isInFavorites: () => false,
    isInUpNext: () => false,
  } as unknown as ListService;
  const option = toBrowseResultOption(
    youtubeLiveResult(),
    undefined,
    "provider",
    undefined,
    listService,
  );

  expect(option.previewBadge).toBe("wl");
  // Nothing is lost: live state is still carried by the meta line and the facts.
  expect(option.previewMeta).toContain("● LIVE");
});

test("an untracked live broadcast still badges its live state", () => {
  const option = toBrowseResultOption(youtubeLiveResult());
  expect(option.previewBadge).toBe("● LIVE");
});

test("live state renders identically wherever it appears", () => {
  for (const [liveStatus, label] of [
    ["live", "● LIVE"],
    ["upcoming", "Upcoming"],
    ["post_live", "Was Live"],
  ] as const) {
    const option = toBrowseResultOption(youtubeLiveResult({ liveStatus }));
    expect(option.previewBadge).toBe(label);
    expect(option.previewMeta).toContain(label);
    expect(option.previewFacts?.some((fact) => fact.detail === label)).toBe(true);
  }
});

test("a Short is labelled from its shape, never from its duration", () => {
  const brief = toBrowseResultOption(
    youtubeLiveResult({ liveStatus: undefined, durationSeconds: 45, contentShape: "video" }),
  );
  expect(brief.detail?.startsWith("Video")).toBe(true);

  const long = toBrowseResultOption(
    youtubeLiveResult({ liveStatus: undefined, durationSeconds: 170, contentShape: "short" }),
  );
  expect(long.detail?.startsWith("Short")).toBe(true);
});
