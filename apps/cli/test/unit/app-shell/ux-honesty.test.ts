import { describe, expect, test } from "bun:test";

import { detailsCardSynopsisWidth } from "@/app-shell/details-view";
import { discoverIncludesItem } from "@/app/discover/discover-results";
import { playbackIntentFromMediaItem } from "@/app/playback/notification-media-session";
import { episodePickerHighlightIndex } from "@/app/playback/playback-episode-picker";
import type { SearchResult } from "@/domain/types";
import { manualArtworkFetchAllowed } from "@/services/offline/manual-artwork";
import { classifySeasonLoadError, seasonLoadFailureMessage } from "@/tmdb";

function result(partial: Partial<SearchResult> & Pick<SearchResult, "id" | "type">): SearchResult {
  return {
    title: partial.title ?? partial.id,
    ...partial,
  } as SearchResult;
}

describe("ux honesty", () => {
  test("discover anime trays keep live-action series out", () => {
    const liveAction = result({ id: "tmdb:1", type: "series", title: "The Wire", isAnime: false });
    const anime = result({ id: "anilist:21", type: "series", title: "Death Note", isAnime: true });
    expect(discoverIncludesItem("anime-only", "series", liveAction)).toBe(false);
    expect(discoverIncludesItem("anime-only", "anime", anime)).toBe(true);
    expect(discoverIncludesItem("auto", "anime", liveAction)).toBe(false);
    expect(discoverIncludesItem("auto", "anime", anime)).toBe(true);
  });

  test("a missing or negative continue index highlights episode 1", () => {
    expect(episodePickerHighlightIndex(undefined, 12)).toBe(0);
    expect(episodePickerHighlightIndex(-1, 12)).toBe(0);
    expect(episodePickerHighlightIndex(3, 12)).toBe(3);
  });

  test("season load failures name 404, parse, and fixture mode", () => {
    expect(seasonLoadFailureMessage(classifySeasonLoadError({ status: 404 }))).toBe(
      "Season data was not found (404).",
    );
    expect(seasonLoadFailureMessage(classifySeasonLoadError(new SyntaxError("bad json")))).toBe(
      "Season data could not be parsed.",
    );
    const previous = process.env.KUNAI_COMPILED_SMOKE;
    process.env.KUNAI_COMPILED_SMOKE = "1";
    try {
      expect(seasonLoadFailureMessage(classifySeasonLoadError(new Error("no")))).toContain(
        "fixture mode",
      );
    } finally {
      if (previous === undefined) delete process.env.KUNAI_COMPILED_SMOKE;
      else process.env.KUNAI_COMPILED_SMOKE = previous;
    }
    expect(seasonLoadFailureMessage("offline")).toContain("Check your connection");
  });

  test("synopsis width is the card row at 80, 100, and 140 columns", () => {
    expect(detailsCardSynopsisWidth(80)).toBe(78);
    expect(detailsCardSynopsisWidth(100)).toBe(98);
    expect(detailsCardSynopsisWidth(140)).toBe(138);
  });

  test("power saver still fetches artwork the user asked for when the setting is on", () => {
    expect(
      manualArtworkFetchAllowed({ powerSaverMode: true, powerSaverAllowManualArtwork: true }),
    ).toBe(true);
    expect(
      manualArtworkFetchAllowed({ powerSaverMode: true, powerSaverAllowManualArtwork: false }),
    ).toBe(false);
    expect(
      manualArtworkFetchAllowed({ powerSaverMode: false, powerSaverAllowManualArtwork: false }),
    ).toBe(true);
  });

  test("a notification plays the title captured on the item, not another selected name", () => {
    const intent = playbackIntentFromMediaItem({
      mediaKind: "series",
      titleId: "tmdb:1396",
      title: "Captured Title",
    });
    expect(intent.title.name).toBe("Captured Title");
    expect(intent.title.name).not.toBe("Globally Selected");
  });
});
