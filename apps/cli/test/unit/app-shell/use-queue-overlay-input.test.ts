import { describe, expect, test } from "bun:test";

import { handleQueueOverlayInput } from "@/app-shell/use-queue-overlay-input";

import { createConfirmStripHarness } from "./history-confirm-test-utils";

function armedQueue() {
  const confirm = createConfirmStripHarness();
  confirm.transition({
    type: "arm",
    targetId: "remove:q1",
    label: "Demo",
    verb: "remove",
    visibleIds: ["remove:q1"],
  });
  let removed = 0;
  const ctx = {
    container: {
      queueService: {
        getAll: () => [{ id: "q1" }],
        remove: () => {
          removed += 1;
        },
      },
    },
    rows: [{ id: "q1" }],
    selectedIndex: 0,
    setSelectedIndex: () => {},
    setOverlayStatus: () => {},
    refresh: () => {},
    confirm: {
      getState: () => confirm.state,
      transition: confirm.transition,
    },
    confirmationVisibleIds: ["q1"],
    activateRow: () => {},
  };
  // SAFETY: partial queue context — the confirmation tests only read confirm and queueService.remove.
  return { confirm, ctx: ctx as never, removed: () => removed };
}

describe("handleQueueOverlayInput confirmation", () => {
  test("Ctrl+Y does not remove the armed Up Next row", () => {
    const { confirm, ctx, removed } = armedQueue();
    expect(handleQueueOverlayInput("y", { ctrl: true }, ctx)).toBe("handled");
    expect(removed()).toBe(0);
    expect(confirm.state.kind).toBe("armed");
  });

  test("Down disarms and lets the overlay move the cursor", () => {
    const { confirm, ctx } = armedQueue();
    expect(handleQueueOverlayInput("", { downArrow: true }, ctx)).toBe("not-handled");
    expect(confirm.state.kind).toBe("idle");
  });

  test("a failed removal stays until Escape", () => {
    const confirm = createConfirmStripHarness();
    confirm.transition({
      type: "arm",
      targetId: "q1",
      label: "Demo",
      verb: "remove",
      visibleIds: ["q1"],
    });
    confirm.transition({ type: "confirm" });
    confirm.transition({ type: "fail", message: "still queued" });
    const ctx = {
      container: {},
      rows: [],
      selectedIndex: 0,
      setSelectedIndex: () => {},
      setOverlayStatus: () => {},
      refresh: () => {},
      confirm: { getState: () => confirm.state, transition: confirm.transition },
      confirmationVisibleIds: ["q1"],
      activateRow: () => {},
    };
    // SAFETY: partial queue context — this test only reads the confirmation state.
    expect(handleQueueOverlayInput("", { downArrow: true }, ctx as never)).toBe("handled");
    expect(confirm.state).toMatchObject({ kind: "failed", message: "still queued" });
  });
});
