import { describe, expect, test } from "bun:test";

import { matchTrackSelectionAgainstInventory } from "@/app/playback/tracks-panel-pick";

const inventory = (streams: readonly { readonly id: string; readonly sourceId?: string }[]) => ({
  streams,
});

describe("matchTrackSelectionAgainstInventory", () => {
  test("a live stream id is not stale", () => {
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: null, streamId: "s1" },
        inventory([{ id: "s1", sourceId: "a" }]),
      ),
    ).toBeNull();
  });

  test("a stream id missing after re-resolve is stale", () => {
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: null, streamId: "gone" },
        inventory([{ id: "s1", sourceId: "a" }]),
      ),
    ).toContain("no longer available");
  });

  test("a source id missing after provider switch is stale", () => {
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: "gone", streamId: null },
        inventory([{ id: "s1", sourceId: "a" }]),
      ),
    ).toContain("no longer available");
  });

  test("a missing cache row is not staleness", () => {
    expect(
      matchTrackSelectionAgainstInventory({ sourceId: null, streamId: "s1" }, null),
    ).toBeNull();
  });

  test("a shape-valid row without a streams array fails open, not TypeError", () => {
    // The repository validator only checks streams when present — a poisoned
    // row like {} or {sources:[]} reaches here with streams undefined.
    expect(matchTrackSelectionAgainstInventory({ sourceId: null, streamId: "s1" }, {})).toBeNull();
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: "a", streamId: null },
        // SAFETY: {sources:[]} is the poisoned-row shape the repository
        // validator accepts — the cast manufactures exactly that payload.
        { sources: [] } as never,
      ),
    ).toBeNull();
  });
});
