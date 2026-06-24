import { describe, expect, test } from "bun:test";

import { buildPickerActionContext, waitForOverlayClose } from "@/app-shell/workflows";

import { createContainerFixture } from "../../support/container-fixture";

describe("workflows characterization", () => {
  test("buildPickerActionContext wires footer mode and command dispatch", () => {
    const { container } = createContainerFixture({
      config: { minimalMode: false, footerHints: "detailed" },
      shellChrome: { footerMode: "detailed" },
    } as never);
    const ctx = buildPickerActionContext({
      container,
      taskLabel: "Pick an episode",
    });

    expect(ctx.taskLabel).toBe("Pick an episode");
    expect(ctx.footerMode).toBeDefined();
    expect(Array.isArray(ctx.commands)).toBe(true);
    expect(typeof ctx.onAction).toBe("function");
  });

  test("waitForOverlayClose resolves when overlay type is no longer on top", async () => {
    const { stateManager, closeTopOverlay } = createContainerFixture();
    stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: { type: "history" },
    });

    const pending = waitForOverlayClose(stateManager as never, "history");
    closeTopOverlay();

    await expect(pending).resolves.toBeUndefined();
  });
});
