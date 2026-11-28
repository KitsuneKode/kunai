import { describe, expect, test } from "bun:test";

import { searchOfflineLibrary } from "@/app/search/offline-search";
import { applyOfflineCommandAvailability } from "@/domain/session/command-registry";
import { deriveOfflineMode } from "@/domain/session/offline-mode";

describe("offline-first shell policy", () => {
  test("derives one offline value from explicit intent or connectivity", () => {
    expect(deriveOfflineMode({ explicitOffline: true, networkAvailable: true })).toEqual({
      active: true,
      source: "explicit",
    });
    expect(deriveOfflineMode({ explicitOffline: false, networkAvailable: false }).active).toBe(
      true,
    );
    expect(deriveOfflineMode({ explicitOffline: false, networkAvailable: true }).active).toBe(
      false,
    );
  });

  test("disables online discovery commands with a connection reason", () => {
    const command = {
      id: "trending" as const,
      label: "Trending",
      aliases: ["trending"],
      description: "Trending",
      enabled: true,
    };
    expect(applyOfflineCommandAvailability(command, true)).toMatchObject({
      enabled: false,
      reason: "needs a connection",
    });
    expect(applyOfflineCommandAvailability(command, false).enabled).toBe(true);
  });

  test("offline search matches downloaded titles before history-only titles", () => {
    const container = {
      offlineAssetService: {
        listAllAssets: () => [
          {
            titleId: "tmdb:1",
            titleName: "Smoke Movie",
            mediaKind: "movie",
            state: "ready",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
      historyRepository: {
        listLatestByTitle: () => [
          {
            titleId: "tmdb:2",
            title: "Smoke Series",
            mediaKind: "series",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    } as never;
    expect(searchOfflineLibrary(container, "smoke").map((result) => result.title)).toEqual([
      "Smoke Movie",
      "Smoke Series",
    ]);
  });
});
