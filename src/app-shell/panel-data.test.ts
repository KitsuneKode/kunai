import { describe, expect, test } from "bun:test";

import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
} from "@/app-shell/panel-data";
import { createInitialState } from "@/domain/session/SessionState";

describe("panel-data", () => {
  test("buildHelpPanelLines returns stable guidance", () => {
    const lines = buildHelpPanelLines();
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.some((line) => line.label.includes("Command bar"))).toBe(true);
  });

  test("buildAboutPanelLines includes default mode summary", () => {
    const lines = buildAboutPanelLines({
      config: {
        defaultMode: "anime",
        provider: "vidking",
        animeProvider: "allanime",
        subLang: "en",
        animeLang: "sub",
        headless: true,
        showMemory: false,
        autoNext: true,
        footerHints: "detailed",
      },
      state: createInitialState("vidking", "allanime"),
    });

    expect(lines.find((line) => line.label === "Default startup mode")?.detail).toContain("anime");
  });

  test("buildDiagnosticsPanelLines surfaces missing subtitles clearly", () => {
    const state = createInitialState("vidking", "allanime");
    const lines = buildDiagnosticsPanelLines({
      state,
      recentEvents: [],
    });

    expect(lines.find((line) => line.label === "Selected subtitle URL")?.detail).toBe(
      "not found or disabled",
    );
    expect(lines.find((line) => line.label === "Subtitle diagnosis")?.tone).toBe("warning");
  });

  test("buildHistoryPanelLines sorts newest entries first", () => {
    const lines = buildHistoryPanelLines([
      [
        "older",
        {
          title: "Older Show",
          type: "series",
          season: 1,
          episode: 2,
          timestamp: 120,
          duration: 300,
          provider: "vidking",
          watchedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      [
        "newer",
        {
          title: "Newer Show",
          type: "series",
          season: 2,
          episode: 4,
          timestamp: 180,
          duration: 300,
          provider: "allanime",
          watchedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    ]);

    expect(lines[0]?.label).toContain("Newer Show");
  });

  test("buildProviderPickerOptions marks current provider", () => {
    const options = buildProviderPickerOptions({
      currentProvider: "allanime",
      providers: [
        {
          id: "allanime",
          name: "AllAnime",
          description: "Anime provider",
          recommended: false,
          isAnimeProvider: true,
        },
        {
          id: "cineby-anime",
          name: "Cineby Anime",
          description: "Fallback anime provider",
          recommended: false,
          isAnimeProvider: true,
        },
      ],
    });

    expect(options[0]?.label).toContain("current");
    expect(options[1]?.label).not.toContain("current");
  });
});
