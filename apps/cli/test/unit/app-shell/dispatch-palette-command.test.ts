import { afterEach, describe, expect, mock, test } from "bun:test";

const openSetupWizardFromShell = mock(async () => {});
const handleShellAction = mock(async () => "handled" as const);

mock.module("@/app-shell/workflows/setup-workflows", () => ({
  openSetupWizardFromShell,
}));

mock.module("@/app-shell/workflows", () => ({
  handleShellAction,
  resolveQuitWithDownloadQueue: async () => "handled" as const,
}));

const { dispatchPaletteCommand } = await import("@/app-shell/dispatch-palette-command");

afterEach(() => {
  openSetupWizardFromShell.mockClear();
  handleShellAction.mockClear();
});

describe("dispatchPaletteCommand", () => {
  test("setup routes through the dedicated wizard once, not generic shell workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    const browseResult = await dispatchPaletteCommand("browse", "setup", container as never);
    const playbackResult = await dispatchPaletteCommand("playback", "setup", container as never);

    expect(browseResult).toBe("handled");
    expect(playbackResult).toBe("handled");
    expect(openSetupWizardFromShell).toHaveBeenCalledTimes(2);
    expect(openSetupWizardFromShell).toHaveBeenCalledWith(container, {
      force: true,
      closeOverlays: true,
    });
    expect(handleShellAction).not.toHaveBeenCalled();
  });

  test("provider command returns provider picker intent from the shared dispatcher", async () => {
    const result = await dispatchPaletteCommand("playback", "provider", {} as never);

    expect(result).toBe("provider");
    expect(handleShellAction).not.toHaveBeenCalled();
  });
});
