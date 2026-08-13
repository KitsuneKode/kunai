import { describe, expect, test } from "bun:test";

import {
  buildSearchFailureNote,
  presentSearchFailure,
  shouldRunBootstrapSearch,
} from "@/app/search/search-failure-policy";

describe("search failure policy", () => {
  test("an error state suppresses automatic bootstrap replay but a fresh idle query runs", () => {
    expect(
      shouldRunBootstrapSearch({
        searchQuery: "Bojack Horseman",
        searchResults: [],
        searchState: "error",
      }),
    ).toBe(false);
    expect(
      shouldRunBootstrapSearch({
        searchQuery: "Bojack Horseman",
        searchResults: [],
        searchState: "idle",
      }),
    ).toBe(true);
    expect(
      shouldRunBootstrapSearch({
        searchQuery: "",
        searchResults: [],
        searchState: "idle",
      }),
    ).toBe(false);
  });

  test("offline search failure offers retry and the offline library", () => {
    const note = buildSearchFailureNote(
      {
        code: "NETWORK_ERROR",
        message: "Search service unreachable",
        retryable: true,
      },
      {
        status: "offline",
        checkedAt: 1,
        evidence: "search-error",
        message: "Unable to connect. Is the computer able to access the url?",
      },
    );

    expect(note).toBe("Search failed: Search service unreachable · retry or open /offline");
  });

  test("limited failures offer retry without falsely declaring full offline mode", () => {
    const note = buildSearchFailureNote(
      {
        code: "NETWORK_ERROR",
        message: "Search service timed out",
        retryable: true,
      },
      {
        status: "limited",
        checkedAt: 1,
        evidence: "search-error",
        message: "request timed out",
      },
    );

    expect(note).toBe("Search failed: Search service timed out · retry");
  });

  test("presenting a failure dispatches the actionable note to the shell", () => {
    const actions: unknown[] = [];
    presentSearchFailure(
      {
        connectivity: {
          getSnapshot: () => ({
            status: "offline",
            checkedAt: 1,
            evidence: "search-error",
          }),
        },
        stateManager: {
          dispatch: (action) => actions.push(action),
        },
      },
      {
        code: "NETWORK_ERROR",
        message: "Search service unreachable",
        retryable: true,
      },
    );

    expect(actions).toEqual([
      {
        type: "SET_PLAYBACK_FEEDBACK",
        note: "Search failed: Search service unreachable · retry or open /offline",
      },
    ]);
  });
});
