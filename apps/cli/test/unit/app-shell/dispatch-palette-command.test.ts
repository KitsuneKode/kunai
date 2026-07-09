import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

import { dispatchPaletteCommand } from "@/app-shell/dispatch-palette-command";
import * as rootOverlayBridge from "@/app-shell/root-overlay-bridge";
import * as rootQueueBridge from "@/app-shell/root-queue-bridge";
import * as workflows from "@/app-shell/workflows";
import * as setupWorkflows from "@/app-shell/workflows/setup-workflows";

beforeEach(() => {
  spyOn(setupWorkflows, "openSetupWizardFromShell").mockImplementation(async () => {});
  spyOn(rootOverlayBridge, "openRootOwnedOverlay").mockImplementation(async () => {});
  spyOn(rootOverlayBridge, "openNotificationsOverlay").mockImplementation(async () => ({
    playback: null,
  }));
  spyOn(rootQueueBridge, "waitForRootQueueSelection").mockImplementation(async () => null);
  spyOn(workflows, "handleShellAction").mockImplementation(async () => "handled" as const);
  spyOn(workflows, "resolveQuitWithDownloadQueue").mockImplementation(async () => "handled" as const);
});

afterEach(() => {
  mock.restore();
});

describe("dispatchPaletteCommand", () => {
  test("setup routes through the dedicated wizard once, not generic shell workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    const browseResult = await dispatchPaletteCommand("browse", "setup", container as never);
    const playbackResult = await dispatchPaletteCommand("playback", "setup", container as never);

    expect(browseResult).toBe("handled");
    expect(playbackResult).toBe("handled");
    expect(setupWorkflows.openSetupWizardFromShell).toHaveBeenCalledTimes(2);
    expect(setupWorkflows.openSetupWizardFromShell).toHaveBeenCalledWith(container, {
      force: true,
      closeOverlays: true,
    });
    expect(workflows.handleShellAction).not.toHaveBeenCalled();
  });

  test("provider command returns provider picker intent from the shared dispatcher", async () => {
    const result = await dispatchPaletteCommand("playback", "provider", {} as never);

    expect(result).toBe("provider");
    expect(workflows.handleShellAction).not.toHaveBeenCalled();
  });

  test("routes saved-media palette actions to distinct workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    await expect(dispatchPaletteCommand("browse", "up-next", container as never)).resolves.toBe(
      "handled",
    );
    expect(rootOverlayBridge.openRootOwnedOverlay).toHaveBeenCalledWith(container, {
      type: "queue",
    });
    expect(workflows.handleShellAction).not.toHaveBeenCalled();

    await expect(dispatchPaletteCommand("browse", "playlists", container as never)).resolves.toBe(
      "handled",
    );
    await expect(dispatchPaletteCommand("browse", "playlist", container as never)).resolves.toBe(
      "handled",
    );
    expect(workflows.handleShellAction).toHaveBeenCalledTimes(2);
    expect(workflows.handleShellAction).toHaveBeenCalledWith({
      action: "playlists",
      container,
    });
  });
});
