import { describe, expect, test } from "bun:test";

import {
  buildNowPlayingGoStrip,
  playbackHasSkippableSegment,
} from "@/app-shell/now-playing-go-strip.model";
import { measureColumns } from "@/app-shell/shell-text";
import {
  DETACHED_HANDOFF_CAPABILITIES,
  MANAGED_MPV_CAPABILITIES,
  VLC_CAPABILITIES,
} from "@/domain/playback/player-capabilities";
import type { PlaybackTimingMetadata } from "@/domain/types";

const introTiming: PlaybackTimingMetadata = {
  tmdbId: "1",
  type: "series",
  intro: [{ startMs: 10_000, endMs: 90_000 }],
  recap: [],
  credits: [],
  preview: [],
};

const series = {
  contentKind: "series" as const,
  titleType: "series" as const,
  hasNextEpisode: true,
  hasPreviousEpisode: true,
  hasSkippableSegment: true,
  canOpenTracks: true,
  capabilities: MANAGED_MPV_CAPABILITIES,
  width: 120,
};

describe("playbackHasSkippableSegment", () => {
  test("is true only while the playhead is inside a timed window", () => {
    expect(playbackHasSkippableSegment(introTiming, 30)).toBe(true);
    expect(playbackHasSkippableSegment(introTiming, 0)).toBe(false);
    expect(playbackHasSkippableSegment(introTiming, 120)).toBe(false);
    expect(playbackHasSkippableSegment(null, 30)).toBe(false);
  });
});

describe("buildNowPlayingGoStrip", () => {
  test("a series with a live skip window lists the deck shortcuts in scan order", () => {
    expect(buildNowPlayingGoStrip(series).line).toBe(
      "GO  n next · p prev · b skip · e episodes · o tracks",
    );
    expect(buildNowPlayingGoStrip(series).limitation).toBeNull();
  });

  test("a movie offers tracks, and a credits window, never episode shortcuts", () => {
    const line = buildNowPlayingGoStrip({
      ...series,
      contentKind: "movie",
      titleType: "movie",
      hasSkippableSegment: false,
    }).line;
    expect(line).toBe("GO  o tracks");
    expect(line).not.toContain("n next");
    expect(line).not.toContain("p prev");
    expect(line).not.toContain("e episodes");

    const credits = buildNowPlayingGoStrip({
      ...series,
      contentKind: "movie",
      titleType: "movie",
    }).line;
    expect(credits).toContain("b skip");
    expect(credits).not.toContain("n next");
    expect(credits).not.toContain("e episodes");
  });

  test("an anime episode keeps episode shortcuts and an anime film does not", () => {
    expect(
      buildNowPlayingGoStrip({
        ...series,
        contentKind: "anime",
        titleType: "series",
        hasSkippableSegment: false,
      }).line,
    ).toContain("e episodes");
    const film = buildNowPlayingGoStrip({
      ...series,
      contentKind: "anime",
      titleType: "movie",
    }).line;
    expect(film).not.toContain("e episodes");
    expect(film).not.toContain("n next");
  });

  test("first and last episodes drop the shortcut that would no-op", () => {
    expect(
      buildNowPlayingGoStrip({ ...series, hasPreviousEpisode: false, hasSkippableSegment: false })
        .line,
    ).not.toContain("p prev");
    expect(
      buildNowPlayingGoStrip({ ...series, hasNextEpisode: false, hasSkippableSegment: false }).line,
    ).not.toContain("n next");
  });

  test("no skip chip without a segment, even when the player can seek", () => {
    expect(buildNowPlayingGoStrip({ ...series, hasSkippableSegment: false }).line).not.toContain(
      "b skip",
    );
  });

  test("VLC withholds tracks and says so, and a detached player offers no chips", () => {
    const vlc = buildNowPlayingGoStrip({
      ...series,
      capabilities: VLC_CAPABILITIES,
      hasSkippableSegment: false,
    });
    expect(vlc.line).not.toContain("o tracks");
    expect(vlc.line).toContain("n next");
    expect(vlc.limitation).toBe("Track switches need mpv");

    const detached = buildNowPlayingGoStrip({
      ...series,
      capabilities: DETACHED_HANDOFF_CAPABILITIES,
    });
    expect(detached.line).toBe("");
    expect(detached.limitation).toBe("Controls are in the external player");
  });

  test("a 40-column row stays on one line by dropping the tail", () => {
    const line = buildNowPlayingGoStrip({ ...series, width: 40 }).line;
    expect(measureColumns(line)).toBeLessThanOrEqual(40);
    expect(line.startsWith("GO  ")).toBe(true);
    expect(line).toContain("n next");
    expect(line).not.toContain("o tracks");
  });
});
