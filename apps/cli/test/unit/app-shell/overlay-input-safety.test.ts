import { describe, expect, test } from "bun:test";

import {
  isOverlayCancelActive,
  shouldHandleOverlayEscape,
  shouldOverlayAcceptFilterInput,
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
      shouldOverlayAcceptFilterInput({
        overlayType: "history",
        textZoneActive: true,
        notificationActionPickerActive: false,
        historyPendingDelete: { kind: "episode", key: "k", label: "Demo" },
        historySourceChoiceTitleId: null,
      }),
    ).toBe(false);
  });

  test("queue and notifications inbox never feed an unseen filter editor", () => {
    // Neither surface renders a filter field, so letters must stay actions or
    // inert — not parked in filterQuery where the first Esc then clears an
    // invisible filter instead of closing.
    for (const overlayType of ["queue", "downloads", "library", "tracks_panel"] as const) {
      expect(
        shouldOverlayAcceptFilterInput({
          overlayType,
          textZoneActive: false,
          notificationActionPickerActive: false,
          historyPendingDelete: null,
          historySourceChoiceTitleId: null,
        }),
      ).toBe(false);
    }
    expect(
      shouldOverlayAcceptFilterInput({
        overlayType: "notifications",
        textZoneActive: false,
        notificationActionPickerActive: false,
        historyPendingDelete: null,
        historySourceChoiceTitleId: null,
      }),
    ).toBe(false);
    // The nested action picker does render a filter field.
    expect(
      shouldOverlayAcceptFilterInput({
        overlayType: "notifications",
        textZoneActive: false,
        notificationActionPickerActive: true,
        historyPendingDelete: null,
        historySourceChoiceTitleId: null,
      }),
    ).toBe(true);
  });

  test("zoned surfaces type in the text zone and act in the list zone", () => {
    const base = {
      notificationActionPickerActive: false,
      historyPendingDelete: null,
      historySourceChoiceTitleId: null,
    } as const;
    // Episode picker + history: letters are filter input only while the text
    // zone owns them.
    for (const overlayType of ["episode_picker", "history"] as const) {
      expect(shouldOverlayAcceptFilterInput({ ...base, overlayType, textZoneActive: true })).toBe(
        true,
      );
      expect(shouldOverlayAcceptFilterInput({ ...base, overlayType, textZoneActive: false })).toBe(
        false,
      );
    }
    // Filter-only pickers always accept text — they have no letter actions.
    for (const overlayType of [
      "provider_picker",
      "season_picker",
      "subtitle_picker",
      "recommendation_picker",
    ] as const) {
      expect(shouldOverlayAcceptFilterInput({ ...base, overlayType, textZoneActive: false })).toBe(
        true,
      );
    }
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
