import { describe, expect, test } from "bun:test";

import { isOverlayCancelActive, shouldHandleOverlayEscape } from "@/app-shell/overlay-input-safety";

describe("overlay input safety", () => {
  test("provider picker filter disables overlay cancel while typing", () => {
    expect(
      isOverlayCancelActive({
        overlay: { type: "provider_picker", currentProvider: "allanime", isAnime: true },
        pickerFilterQuery: "all",
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
        overlay: { type: "provider_picker", currentProvider: "allanime", isAnime: true },
        pickerFilterQuery: "all",
      }),
    ).toBe(false);
  });
});
