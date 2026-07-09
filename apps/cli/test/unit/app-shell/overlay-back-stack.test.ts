import { describe, expect, test } from "bun:test";

import { resolveOverlayBackStack } from "@/app-shell/overlay-back-stack";
import { resolveEscTransition } from "@/app-shell/root-shell-state";
import { createInitialState, reduceState } from "@/domain/session/SessionState";

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

  test("root-overlay Esc close-overlay matches resolveEscTransition CLOSE_TOP_OVERLAY", () => {
    // Production Esc for root-owned overlays is owned by root-overlay-shell +
    // resolveOverlayBackStack. When the back-stack says close-overlay, the shell
    // dispatches CLOSE_TOP_OVERLAY — the same transition resolveEscTransition
    // would return. Do not wire both into the same key handler.
    let state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });
    state = reduceState(state, {
      type: "OPEN_OVERLAY",
      overlay: { type: "help" },
    });

    expect(resolveOverlayBackStack({})).toBe("close-overlay");
    expect(resolveEscTransition(state)).toEqual({ type: "CLOSE_TOP_OVERLAY" });
  });
});
