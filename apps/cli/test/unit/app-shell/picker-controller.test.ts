import { describe, expect, test } from "bun:test";

import {
  confirmPickerSelection,
  createPickerState,
  getFilteredPickerOptions,
  movePickerSelection,
  updatePickerFilter,
  resolvePickerEscape,
} from "@/app-shell/picker-controller";

const options = [
  { value: "source:cdn", label: "CDN", detail: "1080p  ·  hardsub en" },
  { value: "source:backup", label: "Backup", detail: "720p  ·  audio ja" },
  { value: "source:mp4", label: "MP4", detail: "480p" },
  { value: "source:hls", label: "HLS", detail: "adaptive stream" },
];

describe("picker controller", () => {
  test("filters by label and detail while resetting selection", () => {
    const state = createPickerState({
      id: "source",
      title: "Choose source",
      subtitle: "3 sources",
      options,
      initialIndex: 2,
    });

    const filtered = updatePickerFilter(state, "hardsub");

    expect(filtered.selectedIndex).toBe(0);
    expect(getFilteredPickerOptions(filtered).map((option) => option.value)).toEqual([
      "source:cdn",
    ]);
  });

  test("ranks direct label matches before loose detail matches", () => {
    const state = createPickerState({
      id: "source",
      title: "Choose source",
      subtitle: "4 sources",
      options,
    });

    const filtered = updatePickerFilter(state, "hls");

    expect(getFilteredPickerOptions(filtered).map((option) => option.value)[0]).toBe("source:hls");
  });

  test("wraps selection inside the filtered option set", () => {
    let state = createPickerState({
      id: "source",
      title: "Choose source",
      subtitle: "3 sources",
      options,
    });

    state = movePickerSelection(state, -1);
    expect(confirmPickerSelection(state)).toEqual({
      type: "selected",
      id: "source",
      value: "source:hls",
    });

    state = movePickerSelection(state, 1);
    expect(confirmPickerSelection(state)).toEqual({
      type: "selected",
      id: "source",
      value: "source:cdn",
    });
  });

  test("clears a non-empty filter on first escape and cancels on second escape", () => {
    const state = updatePickerFilter(
      createPickerState({
        id: "quality",
        title: "Choose quality",
        subtitle: "3 streams",
        options,
      }),
      "720",
    );

    const firstEscape = resolvePickerEscape(state);
    expect(firstEscape).toEqual({
      type: "state",
      state: { ...state, filterQuery: "", selectedIndex: 0 },
    });
    expect(firstEscape.type).toBe("state");
    if (firstEscape.type !== "state") {
      throw new Error("expected first escape to clear filter");
    }

    expect(resolvePickerEscape(firstEscape.state)).toEqual({
      type: "cancelled",
      id: "quality",
    });
  });
});
