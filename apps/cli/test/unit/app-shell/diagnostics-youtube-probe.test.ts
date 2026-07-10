import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { buildDiagnosticsPanelInput } from "@/app-shell/diagnostics-panel-source";
import { buildDiagnosticsPanelLines } from "@/app-shell/panel-data";
import * as rootOverlayBridge from "@/app-shell/root-overlay-bridge";
import { handleShellAction } from "@/app-shell/workflows";
import { createInitialState } from "@/domain/session/SessionState";
import type { YoutubeDiagnosticsProbe } from "@/services/youtube/youtube-diagnostics-probes";
import * as youtubeDiagnosticsProbes from "@/services/youtube/youtube-diagnostics-probes";

import { createContainerFixture } from "../../support/container-fixture";

const sampleProbe: YoutubeDiagnosticsProbe = {
  ytDlp: { available: true, version: "2024.10.07" },
  invidious: {
    ok: true,
    instance: "https://yewtu.be",
    latencyMs: 120,
    instanceCount: 3,
  },
};

function createDiagnosticsPanelContainer() {
  const { container, stateManager } = createContainerFixture({
    debugTracePath: undefined,
    capabilitySnapshot: null,
    diagnosticsService: {
      getRecent: () => [],
      record: () => undefined,
    },
    downloadService: {
      listActive: () => [],
      listCompleted: () => [],
      listFailed: () => [],
    },
    releaseProgressCache: {
      summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
      summarizeDiagnostics: () => null,
    },
    presence: {
      getSnapshot: () => null,
    },
    providerRegistry: {
      getAll: () => [],
    },
    providerHealth: {
      get: () => undefined,
    },
  } as never);

  const sessionState = createInitialState("youtube", "youtube", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "en" },
    movie: { audio: "original", subtitle: "en" },
  });

  return {
    ...container,
    stateManager: {
      ...stateManager,
      getState: () => ({ ...sessionState, activeModals: stateManager.getState().activeModals }),
    },
  };
}

describe("diagnostics YouTube probe threading", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
  });

  test("buildDiagnosticsPanelLines surfaces yt-dlp and Invidious when youtubeProbe is provided", () => {
    const state = createInitialState("youtube", "youtube", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "en" },
      movie: { audio: "original", subtitle: "en" },
    });

    const lines = buildDiagnosticsPanelLines({
      state,
      recentEvents: [],
      youtubeProbe: sampleProbe,
    });

    expect(lines.find((line) => line.label === "YouTube tooling")?.detail).toContain("yt-dlp");
    expect(lines.find((line) => line.label === "YouTube tooling")?.detail).toContain("2024.10.07");
    expect(lines.find((line) => line.label === "Invidious metadata")?.detail).toContain("yewtu.be");
    expect(lines.find((line) => line.label === "YouTube tooling")?.tone).toBe("success");
    expect(lines.find((line) => line.label === "Invidious metadata")?.tone).toBe("success");
  });

  test("buildDiagnosticsPanelInput passes youtubeProbe through to panel input", () => {
    const panelContainer = createDiagnosticsPanelContainer();

    const input = buildDiagnosticsPanelInput(panelContainer as never, {
      youtubeProbe: sampleProbe,
    });

    expect(input.youtubeProbe).toEqual(sampleProbe);

    const lines = buildDiagnosticsPanelLines(input);
    expect(lines.find((line) => line.label === "YouTube tooling")?.detail).toContain("yt-dlp");
    expect(lines.find((line) => line.label === "Invidious metadata")?.detail).toContain("yewtu.be");
  });

  test("handleDiagnostics opens the unified overlay with a live youtubeProbe", async () => {
    const probeSpy = spyOn(
      youtubeDiagnosticsProbes,
      "runYoutubeDiagnosticsProbes",
    ).mockImplementation(async () => sampleProbe);
    spies.push(probeSpy);

    const opened: {
      overlay: { type: string; youtubeProbe?: YoutubeDiagnosticsProbe } | null;
    } = { overlay: null };
    const openSpy = spyOn(rootOverlayBridge, "openRootOwnedOverlay").mockImplementation(
      async (_container, overlay) => {
        opened.overlay = overlay as { type: string; youtubeProbe?: YoutubeDiagnosticsProbe };
      },
    );
    spies.push(openSpy);

    const panelContainer = createDiagnosticsPanelContainer();
    const result = await handleShellAction({
      action: "diagnostics",
      container: panelContainer as never,
    });

    expect(result).toBe("handled");
    expect(probeSpy).toHaveBeenCalled();
    expect(opened.overlay).toEqual({
      type: "diagnostics",
      youtubeProbe: sampleProbe,
    });

    // Same path root-overlay-shell uses once the overlay carries the probe.
    const lines = buildDiagnosticsPanelLines(
      buildDiagnosticsPanelInput(panelContainer as never, {
        youtubeProbe: opened.overlay?.youtubeProbe,
      }),
    );
    expect(lines.find((line) => line.label === "YouTube tooling")?.detail).toContain("yt-dlp");
    expect(lines.find((line) => line.label === "Invidious metadata")?.detail).toContain("yewtu.be");
  });
});
