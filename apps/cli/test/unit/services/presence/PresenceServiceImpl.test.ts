import { describe, expect, test } from "bun:test";

import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { buildDiscordActivity, PresenceServiceImpl } from "@/services/presence/PresenceServiceImpl";

function createConfig(partial: Partial<KitsuneConfig>): ConfigService {
  const raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...partial };
  return {
    ...raw,
    getRaw: () => ({ ...raw }),
    update: async () => undefined,
    save: async () => undefined,
    reset: async () => undefined,
  };
}

function createDiagnostics(): DiagnosticsStore & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    record: (event) => {
      messages.push(event.message);
    },
    getRecent: () => [],
    getSnapshot: () => [],
    clear: () => {
      messages.length = 0;
    },
  };
}

describe("PresenceServiceImpl", () => {
  test("stays disabled by default", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "off" }),
      diagnosticsStore: diagnostics,
    });

    await service.updatePlayback({
      mode: "series",
      title: { id: "1", type: "series", name: "Demo" },
      episode: { season: 1, episode: 2 },
      providerId: "vidking",
      startedAtMs: 1000,
    });

    expect(service.getStatus()).toBe("disabled");
    expect(diagnostics.messages).toEqual([]);
  });

  test("marks discord unavailable once when no client id is configured", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord", presenceDiscordClientId: "" }),
      diagnosticsStore: diagnostics,
    });

    await service.updatePlayback({
      mode: "series",
      title: { id: "1", type: "series", name: "Demo" },
      episode: { season: 1, episode: 2 },
      providerId: "vidking",
      startedAtMs: 1000,
    });
    await service.updatePlayback({
      mode: "series",
      title: { id: "1", type: "series", name: "Demo" },
      episode: { season: 1, episode: 3 },
      providerId: "vidking",
      startedAtMs: 2000,
    });

    expect(service.getStatus()).toBe("unavailable");
    expect(diagnostics.messages).toEqual(["Discord presence needs a client id"]);
  });

  test("builds privacy-safe discord activity", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Breaking Bad" },
      episode: { season: 4, episode: 9 },
      providerId: "vidking",
      startedAtMs: 1000,
    };

    expect(buildDiscordActivity(activity, "full")).toMatchObject({
      details: "Breaking Bad S04E09",
      state: "series · vidking",
    });
    expect(buildDiscordActivity(activity, "private")).toMatchObject({
      details: "Watching with Kunai",
      state: "Playback active",
    });
  });
});
