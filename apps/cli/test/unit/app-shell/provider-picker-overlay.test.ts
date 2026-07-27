import { expect, test } from "bun:test";

import { openSessionProviderPicker } from "@/app-shell/provider-picker-overlay";
import type { Container } from "@/container";

test("session provider selection opens exactly one root-owned picker", async () => {
  let activeModals: Array<Record<string, unknown>> = [];
  const listeners = new Set<(state: { activeModals: typeof activeModals }) => void>();
  const stateManager = {
    getState: () => ({ mode: "series", provider: "videasy", activeModals }),
    dispatch: (event: { type: string; overlay?: Record<string, unknown> }) => {
      if (event.type === "OPEN_OVERLAY" && event.overlay) {
        activeModals = [...activeModals, event.overlay];
      } else if (event.type === "CLOSE_TOP_OVERLAY") {
        activeModals = activeModals.slice(0, -1);
      }
      for (const listener of listeners) listener({ activeModals });
    },
    subscribe: (listener: (state: { activeModals: typeof activeModals }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const container = { stateManager } as unknown as Container;

  const opened = openSessionProviderPicker(container);
  await Promise.resolve();

  expect(activeModals).toEqual([
    { type: "provider_picker", currentProvider: "videasy", lane: "series" },
  ]);

  stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  await opened;
  expect(activeModals).toEqual([]);
});
