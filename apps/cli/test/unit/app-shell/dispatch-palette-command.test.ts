import { afterEach, describe, expect, mock, test } from "bun:test";

import type { QueuePlaybackLaunch } from "@/app-shell/root-queue-bridge";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

const openSetupWizardFromShell = mock(async () => {});
const handleShellAction = mock(async () => "handled" as const);
const openRootOwnedOverlay = mock(async () => {});
const openDiagnosticsOverlay = mock(async () => {});
const waitForRootQueueSelection = mock(async (): Promise<QueuePlaybackLaunch | null> => null);

function titleInfoFromQueuePlaybackLaunch(launch: QueuePlaybackLaunch): TitleInfo {
  return {
    id: launch.intent.titleId,
    type: launch.intent.mediaKind === "movie" ? "movie" : "series",
    name: launch.title,
    queuePlaybackIntent: launch.intent,
  };
}

function episodeInfoFromQueuePlaybackLaunch(launch: QueuePlaybackLaunch): EpisodeInfo | undefined {
  const { intent } = launch;
  if (intent.mediaKind === "movie") return undefined;
  if (
    intent.season === undefined &&
    intent.episode === undefined &&
    intent.absoluteEpisode === undefined
  ) {
    return undefined;
  }
  return {
    season: intent.season ?? 1,
    episode: intent.episode ?? intent.absoluteEpisode ?? 1,
    absoluteEpisode: intent.absoluteEpisode,
  };
}

mock.module("@/app-shell/workflows/setup-workflows", () => ({
  openSetupWizardFromShell,
}));

mock.module("@/app-shell/root-overlay-bridge", () => ({
  openRootOwnedOverlay,
  openDiagnosticsOverlay,
  openNotificationsOverlay: async () => {},
}));

mock.module("@/app-shell/root-queue-bridge", () => ({
  waitForRootQueueSelection,
  titleInfoFromQueuePlaybackLaunch,
  episodeInfoFromQueuePlaybackLaunch,
}));

mock.module("@/app-shell/workflows/shell-workflows", () => ({
  handleShellAction,
  resolveQuitWithDownloadQueue: async () => "handled" as const,
}));

const { dispatchPaletteCommand } = await import("@/app-shell/dispatch-palette-command");

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

  test("routes saved-media palette actions to distinct workflows", async () => {
    const container = { stateManager: { dispatch: () => {} } };

    await expect(dispatchPaletteCommand("browse", "up-next", container as never)).resolves.toBe(
      "handled",
    );
    expect(openRootOwnedOverlay).toHaveBeenCalledWith(container, { type: "queue" });
    expect(handleShellAction).not.toHaveBeenCalled();

    await expect(dispatchPaletteCommand("browse", "playlists", container as never)).resolves.toBe(
      "handled",
    );
    await expect(dispatchPaletteCommand("browse", "playlist", container as never)).resolves.toBe(
      "handled",
    );
    expect(handleShellAction).toHaveBeenCalledTimes(2);
    expect(handleShellAction).toHaveBeenCalledWith({ action: "playlists", container });
  });

  test("diagnostics routes through the shared overlay opener", async () => {
    const container = { stateManager: { dispatch: () => {} } };
    await expect(dispatchPaletteCommand("browse", "diagnostics", container as never)).resolves.toBe(
      "handled",
    );
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

    const result = await dispatchPaletteCommand("browse", "up-next", container as never);

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
