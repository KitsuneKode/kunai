import { afterEach, describe, expect, mock, test } from "bun:test";

import { dispatchPaletteCommand } from "@/app-shell/dispatch-palette-command";
import {
  createPaletteWorkflowPort,
  type PaletteWorkflowPort,
} from "@/app-shell/palette-workflow-port";
import type { QueuePlaybackLaunch } from "@/app-shell/root-queue-bridge";

// Injected rather than mock.module'd. `mock.module` is process-global and
// applied at load time, so stubbing these bridges here also replaced them for
// every other file in the run: root-overlay-bridge.test.ts saw an
// `openNotificationsOverlay` that resolved `{ playback: null }` and an
// `openRootOwnedOverlay` that never dispatched. Whether that broke anything
// depended on test-file load order, so the suite passed on Linux and failed on
// Windows for the same commit. The port keeps every swap local to this file.
const openSetupWizardFromShell = mock(async () => "completed" as const);
const handleShellAction = mock(async () => "handled" as const);
const openRootOwnedOverlay = mock(async () => {});
const openDiagnosticsOverlay = mock(async () => {});
const waitForRootQueueSelection = mock(async (): Promise<QueuePlaybackLaunch | null> => null);

// Everything not stubbed keeps its real implementation, including the pure
// queue-launch mappers the assertions below depend on.
function createTestPort(): PaletteWorkflowPort {
  return createPaletteWorkflowPort({
    loadShellWorkflows: async () => ({
      ...(await import("@/app-shell/workflows/shell-workflows")),
      handleShellAction,
      resolveQuitWithDownloadQueue: async () => "handled" as const,
    }),
    loadSetupWorkflow: async () => ({
      ...(await import("@/app-shell/workflows/setup-workflows")),
      openSetupWizardFromShell,
    }),
    loadOverlayBridge: async () => ({
      ...(await import("@/app-shell/root-overlay-bridge")),
      openRootOwnedOverlay,
      openDiagnosticsOverlay,
      // Must match the real resolved shape; callers read `.playback`.
      openNotificationsOverlay: async () => ({ playback: null }),
    }),
    loadQueueBridge: async () => ({
      ...(await import("@/app-shell/root-queue-bridge")),
      waitForRootQueueSelection,
    }),
  });
}

const port = createTestPort();

afterEach(() => {
  openSetupWizardFromShell.mockClear();
  handleShellAction.mockClear();
  openRootOwnedOverlay.mockClear();
  openDiagnosticsOverlay.mockClear();
  waitForRootQueueSelection.mockReset();
  waitForRootQueueSelection.mockImplementation(async () => null);
});

describe("dispatchPaletteCommand", () => {
  test("setup routes through the dedicated wizard once, not generic shell workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    const browseResult = await dispatchPaletteCommand(
      "browse",
      "setup",
      container as never,
      undefined,
      port,
    );
    const playbackResult = await dispatchPaletteCommand(
      "playback",
      "setup",
      container as never,
      undefined,
      port,
    );

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
    const result = await dispatchPaletteCommand(
      "playback",
      "provider",
      {} as never,
      undefined,
      port,
    );

    expect(result).toBe("provider");
    expect(handleShellAction).not.toHaveBeenCalled();
  });

  test("routes saved-media palette actions to distinct workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    await expect(
      dispatchPaletteCommand("browse", "up-next", container as never, undefined, port),
    ).resolves.toBe("handled");
    expect(openRootOwnedOverlay).toHaveBeenCalledWith(container, { type: "queue" });
    expect(handleShellAction).not.toHaveBeenCalled();

    await expect(
      dispatchPaletteCommand("browse", "playlists", container as never, undefined, port),
    ).resolves.toBe("handled");
    await expect(
      dispatchPaletteCommand("browse", "playlist", container as never, undefined, port),
    ).resolves.toBe("handled");
    expect(handleShellAction).toHaveBeenCalledTimes(2);
    expect(handleShellAction).toHaveBeenCalledWith({ action: "playlists", container });
  });

  test("diagnostics routes through the shared overlay opener", async () => {
    const container = { stateManager: { dispatch: () => {} } };
    await expect(
      dispatchPaletteCommand("browse", "diagnostics", container as never, undefined, port),
    ).resolves.toBe("handled");
    expect(openDiagnosticsOverlay).toHaveBeenCalledWith(container, "diagnostics-palette");
    expect(openRootOwnedOverlay).not.toHaveBeenCalled();
  });

  test("up-next routes claimed QueuePlaybackLaunch through exact intent identity", async () => {
    const container = { stateManager: { dispatch: () => {} } };
    const claimed: QueuePlaybackLaunch = {
      title: "Claimed Anime",
      intent: {
        queueEntryId: "qe-b",
        titleId: "anilist:99",
        mediaKind: "anime",
        absoluteEpisode: 13,
        source: "queue",
      },
    };
    waitForRootQueueSelection.mockImplementationOnce(async () => claimed);

    const result = await dispatchPaletteCommand(
      "browse",
      "up-next",
      container as never,
      undefined,
      port,
    );

    expect(result).toEqual({
      type: "history-entry",
      title: {
        id: "anilist:99",
        type: "series",
        name: "Claimed Anime",
        queuePlaybackIntent: claimed.intent,
      },
      episode: {
        season: 1,
        episode: 13,
        absoluteEpisode: 13,
      },
    });
    expect(openRootOwnedOverlay).toHaveBeenCalledWith(container, { type: "queue" });
  });
});
