import { describe, expect, test } from "bun:test";

import { resolveOverlayBackStack } from "@/app-shell/overlay-back-stack";

describe("resolveOverlayBackStack", () => {
  test("clears filters before backing out of panes or confirmations", () => {
    expect(
      resolveOverlayBackStack({
        filterQuery: "frieren",
        nestedPaneActive: true,
        confirmationActive: true,
      }),
    ).toBe("clear-filter");
  });

  test("exits nested panes before cancelling confirmations", () => {
    expect(resolveOverlayBackStack({ nestedPaneActive: true, confirmationActive: true })).toBe(
      "exit-pane",
    );
  });

  test("cancels confirmations before closing the overlay", () => {
    expect(resolveOverlayBackStack({ confirmationActive: true })).toBe("cancel-confirmation");
  });

  test("cancels picker overlays once already at root", () => {
    expect(resolveOverlayBackStack({ pickerOverlay: true })).toBe("cancel-picker");
  });

  test("lets self-contained surfaces own their local Escape state", () => {
    expect(resolveOverlayBackStack({ surfaceOwnsEscape: true })).toBe("defer-to-surface");
  });

  test("clears overlay text filters even when text input owns broader cancellation", () => {
    expect(resolveOverlayBackStack({ cancelActive: false, filterQuery: "provider" })).toBe(
      "clear-filter",
    );
  });

  test("does nothing while text input owns Escape and there is no filter to clear", () => {
    expect(resolveOverlayBackStack({ cancelActive: false })).toBe("no-op");
  });

  test("closes root overlays when no local state remains", () => {
    expect(resolveOverlayBackStack({})).toBe("close-overlay");
  });
});
