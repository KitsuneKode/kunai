import { describe, expect, test } from "bun:test";

import {
  isOverlayCancelActive,
  isSettingsTextInputChoice,
  overlayDestructiveCancelMessage,
  shouldHandleOverlayEscape,
} from "@/app-shell/overlay-input-safety";

describe("overlay input safety", () => {
  test("settings text input disables overlay cancel while typing", () => {
    expect(
      isOverlayCancelActive({
        overlay: { type: "settings" },
        settingsChoice: "videasySessionToken",
        filterQuery: "abc",
        pickerFilterQuery: "",
      }),
    ).toBe(false);
  });

  test("provider picker filter disables overlay cancel while typing", () => {
    expect(
      isOverlayCancelActive({
        overlay: { type: "provider_picker", currentProvider: "allanime", isAnime: true },
        settingsChoice: null,
        filterQuery: "",
        pickerFilterQuery: "all",
      }),
    ).toBe(false);
  });

  test("history Esc is owned by the overlay while text filters defer to the editor", () => {
    expect(
      shouldHandleOverlayEscape({
        overlay: { type: "history" },
        settingsChoice: null,
        filterQuery: "",
        pickerFilterQuery: "",
      }),
    ).toBe(true);
    expect(
      shouldHandleOverlayEscape({
        overlay: { type: "provider_picker", currentProvider: "allanime", isAnime: true },
        settingsChoice: null,
        filterQuery: "",
        pickerFilterQuery: "all",
      }),
    ).toBe(false);
  });

  test("isSettingsTextInputChoice recognizes typed settings fields", () => {
    expect(isSettingsTextInputChoice("downloadPath")).toBe(true);
    expect(isSettingsTextInputChoice("provider")).toBe(false);
  });

  test("overlayDestructiveCancelMessage warns on dirty settings", () => {
    expect(
      overlayDestructiveCancelMessage({
        overlay: { type: "settings" },
        settingsDirty: true,
      }),
    ).toContain("Ctrl+C");
  });
});
