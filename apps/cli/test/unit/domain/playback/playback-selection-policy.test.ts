import { describe, expect, test } from "bun:test";

import {
  emptyResolvedStreamSelection,
  resolveEffectiveStreamSelection,
} from "@/domain/playback/playback-selection-policy";

describe("resolveEffectiveStreamSelection", () => {
  test("returns empty when no layers are set", () => {
    expect(resolveEffectiveStreamSelection({})).toEqual(emptyResolvedStreamSelection());
  });

  test("uses episode sourceId and streamId when present", () => {
    expect(
      resolveEffectiveStreamSelection({
        episode: { sourceId: "source:zoro", streamId: "stream:1" },
        titleSourceId: "source:luffy",
      }),
    ).toEqual({ sourceId: "source:zoro", streamId: "stream:1" });
  });

  test("uses episode streamId without sourceId", () => {
    expect(
      resolveEffectiveStreamSelection({
        episode: { sourceId: null, streamId: "stream:720" },
        titleSourceId: "source:luffy",
      }),
    ).toEqual({ sourceId: null, streamId: "stream:720" });
  });

  test("falls back to title sourceId without streamId", () => {
    expect(
      resolveEffectiveStreamSelection({
        episode: emptyResolvedStreamSelection(),
        titleSourceId: "source:zoro",
      }),
    ).toEqual({ sourceId: "source:zoro", streamId: null });
  });

  test("does not merge title source with episode empty selection", () => {
    expect(
      resolveEffectiveStreamSelection({
        episode: { sourceId: null, streamId: null },
        titleSourceId: "source:zoro",
      }),
    ).toEqual({ sourceId: "source:zoro", streamId: null });
  });
});
