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

  test("a known deferred source can be selected before it owns a stream", () => {
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: "source:miruro:next-mirror", streamId: null },
        {
          streams: [{ id: "winner", sourceId: "source:miruro:winner" }],
          sources: [{ id: "source:miruro:next-mirror" }],
        },
      ),
    ).toBeNull();
  });

  test("a source-only inventory can contradict a removed source pick", () => {
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: "removed", streamId: null },
        { sources: [{ id: "known" }] },
      ),
    ).toContain("no longer available");
  });

  test("a declared source does not make an absent exact stream selectable", () => {
    expect(
      matchTrackSelectionAgainstInventory(
        { sourceId: "known", streamId: "removed-stream" },
        { streams: [], sources: [{ id: "known" }] },
      ),
    ).toContain("stream is no longer available");
  });

  test("a missing cache row is not staleness", () => {
    expect(
      matchTrackSelectionAgainstInventory({ sourceId: null, streamId: "s1" }, null),
    ).toBeNull();
  });

  test("an unknown inventory shape fails open, but an empty source list rejects source picks", () => {
    // The repository validator only checks streams when present — a poisoned
    // row like {} or {sources:[]} reaches here with streams undefined.
    expect(matchTrackSelectionAgainstInventory({ sourceId: null, streamId: "s1" }, {})).toBeNull();
    expect(
      matchTrackSelectionAgainstInventory({ sourceId: "a", streamId: null }, { sources: [] }),
    ).toContain("no longer available");
  });
});
