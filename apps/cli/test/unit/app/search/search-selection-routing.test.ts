import { expect, test } from "bun:test";

import {
  applySearchSelectionSessionRouting,
  resolveShellModeForSearchResult,
} from "@/app/search/search-selection-routing";
import type { SearchResult } from "@/domain/types";

const youtubeResult: SearchResult = {
  id: "youtube:dQw4w9WgXcQ",
  type: "movie",
  title: "Never Gonna Give You Up",
  year: "2009",
  overview: "",
  posterPath: null,
  contentShape: "video",
  externalIds: { youtubeId: "dQw4w9WgXcQ" },
};

const baseRow: SearchResult = {
  id: "row-1",
  type: "series",
  title: "Generic Title",
  year: "2024",
  overview: "",
  posterPath: null,
};

test("resolveShellModeForSearchResult routes youtube rows to youtube mode", () => {
  expect(resolveShellModeForSearchResult(youtubeResult, "series")).toBe("youtube");
});

test("selection follows resolvedLane over prior shell mode", () => {
  expect(resolveShellModeForSearchResult({ ...baseRow, resolvedLane: "anime" }, "series")).toBe(
    "anime",
  );
});

test("selection follows resolvedLane series over prior anime shell mode", () => {
  expect(resolveShellModeForSearchResult({ ...baseRow, resolvedLane: "series" }, "anime")).toBe(
    "series",
  );
});

test("applySearchSelectionSessionRouting switches mode and default youtube provider", () => {
  const transitions: unknown[] = [];
  applySearchSelectionSessionRouting(
    {
      stateManager: {
        getState() {
          return {
            mode: "series",
            defaultProviders: { series: "videasy", anime: "allanime", youtube: "youtube" },
          };
        },
        dispatch(transition: unknown) {
          transitions.push(transition);
        },
      },
    } as never,
    youtubeResult,
  );

  expect(transitions).toEqual([{ type: "SET_MODE", mode: "youtube", provider: "youtube" }]);
});
