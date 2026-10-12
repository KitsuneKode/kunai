import { afterEach, describe, expect, mock, test } from "bun:test";

import { dispatchPaletteCommand } from "@/app-shell/dispatch-palette-command";
import {
  createPaletteWorkflowPort,
  type PaletteWorkflowPort,
} from "@/app-shell/palette-workflow-port";
import type { NotificationOverlayOutcome } from "@/app-shell/root-overlay-bridge";
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
const openNotificationsOverlay = mock(
  async (): Promise<{ readonly outcome: NotificationOverlayOutcome | null }> => ({
    outcome: null,
  }),
);

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
      // Must match the real resolved shape; callers read `.outcome`.
      openNotificationsOverlay,
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
  openNotificationsOverlay.mockReset();
  openNotificationsOverlay.mockImplementation(async () => ({ outcome: null }));
});

describe("dispatchPaletteCommand", () => {
  test("setup routes through the dedicated wizard once, not generic shell workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    const browseResult = await dispatchPaletteCommand(
      "browse",
      "setup",
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      container as never,
      undefined,
      port,
    );
    const playbackResult = await dispatchPaletteCommand(
      "playback",
      "setup",
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      dispatchPaletteCommand("browse", "up-next", container as never, undefined, port),
    ).resolves.toBe("handled");
    expect(openRootOwnedOverlay).toHaveBeenCalledWith(container, { type: "queue" });
    expect(handleShellAction).not.toHaveBeenCalled();

    await expect(
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      dispatchPaletteCommand("browse", "playlists", container as never, undefined, port),
    ).resolves.toBe("handled");
    await expect(
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      dispatchPaletteCommand("browse", "playlist", container as never, undefined, port),
    ).resolves.toBe("handled");
    expect(handleShellAction).toHaveBeenCalledTimes(2);
    expect(handleShellAction).toHaveBeenCalledWith({ action: "playlists", container });
  });

  test("diagnostics routes through the shared overlay opener", async () => {
    const container = { stateManager: { dispatch: () => {} } };
    await expect(
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
      },
    };
    waitForRootQueueSelection.mockImplementationOnce(async () => claimed);

    const result = await dispatchPaletteCommand(
      "browse",
      "up-next",
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
        isAnime: true,
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

  test("notifications route turns a playback outcome into a history-entry", async () => {
    const container = {
      featureFlags: { attentionInbox: true },
      stateManager: { dispatch: () => {} },
    };
    openNotificationsOverlay.mockImplementationOnce(async () => ({
      outcome: {
        kind: "playback",
        title: { id: "anilist:55", type: "series", name: "Inbox Anime", isAnime: true },
        episode: { season: 1, episode: 7, absoluteEpisode: 7 },
      },
    }));

    const result = await dispatchPaletteCommand(
      "browse",
      "notifications",
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      container as never,
      undefined,
      port,
    );

    expect(result).toEqual({
      type: "history-entry",
      title: { id: "anilist:55", type: "series", name: "Inbox Anime", isAnime: true },
      episode: { season: 1, episode: 7, absoluteEpisode: 7 },
    });
  });

  test("notifications route handles a details outcome without a playback result", async () => {
    const container = {
      featureFlags: { attentionInbox: true },
      stateManager: { dispatch: () => {} },
    };
    openNotificationsOverlay.mockImplementationOnce(async () => ({
      outcome: {
        kind: "details",
        item: { mediaKind: "series", titleId: "tmdb:9", title: "Details Target" },
      },
    }));

    const result = await dispatchPaletteCommand(
      "browse",
      "notifications",
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      container as never,
      undefined,
      port,
    );

    expect(result).toBe("handled");
  });

  test("notifications route is handled when the inbox is disabled", async () => {
    const dispatched: string[] = [];
    const container = {
      featureFlags: { attentionInbox: false },
      stateManager: { dispatch: (event: { type: string }) => dispatched.push(event.type) },
    };

    const result = await dispatchPaletteCommand(
      "browse",
      "notifications",
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      container as never,
      undefined,
      port,
    );

    expect(result).toBe("handled");
    expect(openNotificationsOverlay).not.toHaveBeenCalled();
    expect(dispatched).toEqual(["SET_PLAYBACK_FEEDBACK"]);
  });
});
