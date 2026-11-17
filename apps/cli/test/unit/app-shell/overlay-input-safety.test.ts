import { describe, expect, test } from "bun:test";

import {
  isOverlayCancelActive,
  isOverlayListBackKey,
  rootOverlayAcceptsTypedFilter,
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

  test("bare q always types in a type-to-filter overlay; Esc is the way out", () => {
    const overlay = {
      type: "provider_picker",
      currentProvider: "allanime",
      lane: "anime",
    } as const;
    expect(rootOverlayAcceptsTypedFilter({ overlay })).toBe(true);
    expect(isOverlayListBackKey("q", {}, { acceptsTypedFilter: true, filterQuery: "v" })).toBe(
      false,
    );
    // Empty filter too: otherwise no filter could start with "q".
    expect(isOverlayListBackKey("q", {}, { acceptsTypedFilter: true, filterQuery: "" })).toBe(
      false,
    );
    expect(isOverlayListBackKey("q", {}, { acceptsTypedFilter: false, filterQuery: "" })).toBe(
      true,
    );
    // History binds letters as commands, so q is "back" there while the filter is empty.
    expect(
      isOverlayListBackKey(
        "q",
        {},
        { acceptsTypedFilter: true, filterQuery: "", lettersAreCommands: true },
      ),
    ).toBe(true);
    expect(
      isOverlayListBackKey(
        "q",
        {},
        { acceptsTypedFilter: true, filterQuery: "fr", lettersAreCommands: true },
      ),
    ).toBe(false);
    expect(
      isOverlayListBackKey("", { escape: true }, { acceptsTypedFilter: true, filterQuery: "v" }),
    ).toBe(true);
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
