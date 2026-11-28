import { describe, expect, test } from "bun:test";

import {
  cancelOverlayConfirmationOnEscape,
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
        historyConfirmationActive: true,
      }),
    ).toBe(true);
    expect(
      shouldHistoryOverlayAcceptFilterInput({
        overlayType: "history",
        confirmationActive: true,
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

  test("Escape with the palette open cancels only an armed or failed confirmation", () => {
    const history = { kind: "armed", cancelled: 0 };
    const queue = { kind: "idle", cancelled: 0 };
    const historyStrip = {
      getState: () => ({ kind: history.kind }),
      transition: () => {
        history.cancelled += 1;
        history.kind = "idle";
      },
    };
    const queueStrip = {
      getState: () => ({ kind: queue.kind }),
      transition: () => {
        queue.cancelled += 1;
      },
    };
    expect(cancelOverlayConfirmationOnEscape("history", historyStrip, queueStrip)).toBe(true);
    expect(history.cancelled).toBe(1);
    expect(queue.cancelled).toBe(0);
    expect(cancelOverlayConfirmationOnEscape("queue", historyStrip, queueStrip)).toBe(false);
    queue.kind = "executing";
    expect(cancelOverlayConfirmationOnEscape("queue", historyStrip, queueStrip)).toBe(false);
  });
});
