import { expect, test } from "bun:test";

import {
  applySearchSelectionSessionRouting,
  resolveShellModeForSearchResult,
} from "@/app/search-selection-routing";
import { buildCalendarItem } from "@/domain/calendar/calendar-item";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
import type { SessionState, StateTransition } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import type { SearchResult } from "@/domain/types";

class TestSessionStateManager implements SessionStateManager {
  private state = createInitialState("vidking", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
  });

  getState(): SessionState {
    return this.state;
  }

  dispatch(transition: StateTransition): void {
    this.state = reduceState(this.state, transition);
  }

  subscribe(): () => void {
    return () => {};
  }

  initialize(): void {}
}

function calendarAnimeResult(): SearchResult {
  const calendar = buildCalendarItem(
    {
      source: "anilist",
      titleId: "21",
      titleName: "Frieren",
      type: "anime",
      episode: 29,
      releaseAt: "2026-06-08T12:00:00.000Z",
      releasePrecision: "timestamp",
      status: "upcoming",
    },
    { nowMs: Date.parse("2026-06-08T10:00:00.000Z") },
  );
  return {
    id: "21",
    type: "series",
    isAnime: true,
    title: "Frieren",
    year: "2026",
    overview: "",
    posterPath: null,
    metadataSource: "AniList calendar",
    calendar,
  };
}

test("resolveShellModeForSearchResult routes calendar anime through anime mode", () => {
  expect(resolveShellModeForSearchResult(calendarAnimeResult(), "series")).toBe("anime");
});

test("resolveShellModeForSearchResult routes calendar TV through series mode", () => {
  const calendar = buildCalendarItem(
    {
      source: "tmdb",
      titleId: "1396",
      titleName: "Breaking Bad",
      type: "series",
      season: 5,
      episode: 3,
      releaseAt: "2026-06-08T12:00:00.000Z",
      releasePrecision: "timestamp",
      status: "upcoming",
    },
    { nowMs: Date.parse("2026-06-08T10:00:00.000Z") },
  );
  const result: SearchResult = {
    id: "1396",
    type: "series",
    title: "Breaking Bad",
    year: "2026",
    overview: "",
    posterPath: null,
    metadataSource: "TMDB calendar",
    calendar,
  };
  expect(resolveShellModeForSearchResult(result, "anime")).toBe("series");
});

test("applySearchSelectionSessionRouting switches session to anime defaults for calendar anime", () => {
  const stateManager = new TestSessionStateManager();

  const mode = applySearchSelectionSessionRouting({ stateManager }, calendarAnimeResult());

  expect(mode).toBe("anime");
  expect(stateManager.getState().mode).toBe("anime");
  expect(stateManager.getState().provider).toBe("allanime");
});
