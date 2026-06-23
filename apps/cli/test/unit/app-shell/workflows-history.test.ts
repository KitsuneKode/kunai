import { describe, expect, test } from "bun:test";

import { handleShellAction } from "@/app-shell/workflows";
import type { Container } from "@/container";

function createContainer(): {
  readonly container: Container;
  readonly dispatches: string[];
  closeTopOverlay: () => void;
} {
  let activeModals: Array<{ type: string }> = [];
  const listeners = new Set<(state: { activeModals: typeof activeModals }) => void>();
  const dispatches: string[] = [];
  const notify = () => {
    for (const listener of listeners) listener({ activeModals });
  };

  const stateManager = {
    getState: () => ({ activeModals }),
    dispatch: (event: { type: string; overlay?: { type: string } }) => {
      if (event.type === "OPEN_OVERLAY" && event.overlay) {
        activeModals = [...activeModals, event.overlay];
        dispatches.push(`open:${event.overlay.type}`);
      }
      if (event.type === "REPLACE_TOP_OVERLAY" && event.overlay) {
        activeModals = [...activeModals.slice(0, -1), event.overlay];
        dispatches.push(`replace:${event.overlay.type}`);
      }
      if (event.type === "CLOSE_TOP_OVERLAY") {
        activeModals = activeModals.slice(0, -1);
        dispatches.push("close");
      }
      notify();
    },
    subscribe: (listener: (state: { activeModals: typeof activeModals }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    container: { stateManager } as unknown as Container,
    dispatches,
    closeTopOverlay: () => stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" }),
  };
}

describe("history workflow action", () => {
  test("continue opens the dedicated Continue Hub overlay", async () => {
    const { container, dispatches, closeTopOverlay } = createContainer();

    const result = handleShellAction({ action: "continue", container });
    await Promise.resolve();

    expect(dispatches).toEqual(["open:continue"]);

    closeTopOverlay();

    await expect(result).resolves.toBe("handled");
    expect(dispatches).toEqual(["open:continue", "close"]);
  });

  test("opens one root-owned history overlay and resolves when it closes", async () => {
    const { container, dispatches, closeTopOverlay } = createContainer();

    const result = handleShellAction({ action: "history", container });
    await Promise.resolve();

    expect(dispatches).toEqual(["open:history"]);

    closeTopOverlay();

    await expect(result).resolves.toBe("handled");
    expect(dispatches).toEqual(["open:history", "close"]);
  });
});
