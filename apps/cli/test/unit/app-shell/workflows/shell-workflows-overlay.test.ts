import { describe, expect, test } from "bun:test";

import { runShellWorkflowFromOverlay } from "@/app-shell/workflows/shell-workflows";
import type { Container } from "@/container";

describe("runShellWorkflowFromOverlay", () => {
  test("closes the top overlay before running workflow handlers", async () => {
    const dispatches: string[] = [];
    let executed = false;
    let modalCount = 1;
    const container = {
      stateManager: {
        getState: () => ({ activeModals: Array.from({ length: modalCount }) }),
        dispatch: (event: { type: string }) => {
          dispatches.push(event.type);
          if (event.type === "CLOSE_TOP_OVERLAY") modalCount = 0;
        },
      },
    } as unknown as Container;

    const result = await runShellWorkflowFromOverlay(container, "setup", {
      execute: async () => {
        executed = true;
        return "handled";
      },
    });

    expect(dispatches[0]).toBe("CLOSE_TOP_OVERLAY");
    expect(executed).toBe(true);
    expect(result).toBe("handled");
  });
});
