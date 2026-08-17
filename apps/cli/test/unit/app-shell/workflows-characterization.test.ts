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

  test("a picker offers the consent-bearing overlays, not a narrower hand-list", () => {
    // These two were unreachable from the starting-point pickers while the
    // footer still advertised `[/] commands`, because the surface carried its
    // own array that had drifted from the registry. Analytics and presence are
    // the ones that matter: both govern data leaving the machine, so "the
    // command does not exist" is the wrong answer to give about them anywhere.
    const { container } = createContainerFixture({
      config: { minimalMode: false, footerHints: "detailed" },
      shellChrome: { footerMode: "detailed" },
    } as never);
    const ids = buildPickerActionContext({ container, taskLabel: "Where to start?" }).commands.map(
      (command) => command.id,
    );

    expect(ids).toContain("analytics");
    expect(ids).toContain("presence");
    expect(ids).toContain("settings");
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
