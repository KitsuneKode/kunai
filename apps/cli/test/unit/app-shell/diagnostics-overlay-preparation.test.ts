import { describe, expect, test } from "bun:test";

import { openDiagnosticsOverlay } from "@/app-shell/root-overlay-bridge";
import type { Container } from "@/container";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { extractYoutubeProbeFromEvents } from "@/services/youtube/youtube-diagnostics-probes";

function createOverlayContainer(events: DiagnosticEvent[] = []): Container {
  let activeModals: Array<{ type: string }> = [];
  const listeners = new Set<(state: { activeModals: typeof activeModals }) => void>();
  const recorded: DiagnosticEvent[] = [...events];

  const stateManager = {
    getState: () => ({ activeModals }),
    dispatch: (event: { type: string; overlay?: { type: string } }) => {
      if (event.type === "OPEN_OVERLAY" && event.overlay) {
        activeModals = [...activeModals, event.overlay];
      }
      if (event.type === "CLOSE_TOP_OVERLAY") {
        activeModals = activeModals.slice(0, -1);
      }
      for (const listener of listeners) {
        listener({ activeModals });
      }
    },
    subscribe: (listener: (state: { activeModals: typeof activeModals }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    stateManager,
    diagnosticsService: {
      record: (
        event: Partial<DiagnosticEvent> & Pick<DiagnosticEvent, "message" | "operation">,
      ) => {
        recorded.push({
          timestamp: Date.now(),
          level: "info",
          category: "runtime",
          ...event,
        });
      },
      getRecent: () => recorded,
    },
  } as unknown as Container;
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("diagnostics overlay preparation", () => {
  test("records memory, runs probes, then opens the overlay", async () => {
    const container = createOverlayContainer();
    const calls: string[] = [];
    let resolveProbes: (() => void) | undefined;
    const probesReady = new Promise<void>((resolve) => {
      resolveProbes = resolve;
    });

    const opened = openDiagnosticsOverlay(container, "diagnostics-palette", async () => ({
      recordMemorySample: (_container, source) => {
        calls.push(`memory:${source}`);
      },
      runYoutubeProbes: async () => {
        calls.push("youtube");
        await probesReady;
        container.diagnosticsService.record({
          category: "runtime",
          operation: "youtube.ytdlp.probe",
          message: "yt-dlp probe",
          context: { available: true, version: "2026.01.01" },
        });
        container.diagnosticsService.record({
          category: "provider",
          operation: "youtube.invidious.health",
          message: "invidious ok",
          context: { ok: true, instance: "https://example.test", latencyMs: 12 },
        });
      },
    }));

    await flushMicrotasks();
    expect(container.stateManager.getState().activeModals).toEqual([]);
    expect(calls).toEqual(["memory:diagnostics-palette", "youtube"]);

    resolveProbes?.();
    await flushMicrotasks();
    expect(container.stateManager.getState().activeModals.at(-1)).toEqual({ type: "diagnostics" });

    const probe = extractYoutubeProbeFromEvents(container.diagnosticsService.getRecent());
    expect(probe?.ytDlp.available).toBe(true);
    expect(probe?.invidious.ok).toBe(true);

    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    await opened;
  });
});
