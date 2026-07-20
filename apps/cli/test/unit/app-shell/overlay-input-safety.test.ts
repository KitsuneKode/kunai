import { describe, expect, test } from "bun:test";

import {
  isOverlayCancelActive,
  shouldHandleOverlayEscape,
  shouldHistoryOverlayAcceptFilterInput,
} from "@/app-shell/overlay-input-safety";

describe("overlay input safety", () => {
  test("provider picker filter disables overlay cancel while typing", () => {
    expect(
      isOverlayCancelActive({
        overlay: { type: "provider_picker", currentProvider: "allanime", lane: "anime" },
        pickerFilterQuery: "all",
      }),
    ).toBe(false);
  });

  test("history delete confirm disables filter typing", () => {
    expect(
      isOverlayCancelActive({
        overlay: { type: "history" },
        pickerFilterQuery: "",
        historyPendingDelete: { kind: "episode", key: "k", label: "Demo" },
      }),
    ).toBe(true);
    expect(
      shouldHistoryOverlayAcceptFilterInput({
        overlayType: "history",
        pendingDelete: { kind: "episode", key: "k", label: "Demo" },
        sourceChoiceTitleId: null,
      }),
    ).toBe(false);
  });

  test("history Esc is owned by the overlay while text filters defer to the editor", () => {
    expect(
      shouldHandleOverlayEscape({
        overlay: { type: "history" },
        pickerFilterQuery: "",
      }),
    ).toBe(true);
    expect(
      shouldHandleOverlayEscape({
        overlay: { type: "provider_picker", currentProvider: "allanime", lane: "anime" },
        pickerFilterQuery: "all",
      }),
    ).toBe(false);
  });
});
