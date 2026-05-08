import { describe, expect, test } from "bun:test";

import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import {
  buildDiscordActivity,
  buildPresenceSnapshot,
  describePresenceConfiguration,
  PresenceServiceImpl,
  resolvePresenceClientId,
  resolvePresenceClientIdSource,
} from "@/services/presence/PresenceServiceImpl";

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

  test("describes effective discord client id source", () => {
    expect(
      describePresenceConfiguration(createConfig({ presenceProvider: "off" }), {
        KUNAI_DISCORD_CLIENT_ID: "env-id",
      }),
    ).toBe("off");
    expect(
      describePresenceConfiguration(
        createConfig({ presenceProvider: "discord", presenceDiscordClientId: "config-id" }),
        {},
      ),
    ).toContain("config client id");
    expect(
      describePresenceConfiguration(createConfig({ presenceProvider: "discord" }), {
        KUNAI_DISCORD_CLIENT_ID: "env-id",
      }),
    ).toContain("env client id");
  });

  test("resolves Discord client id and source deterministically", () => {
    expect(
      resolvePresenceClientId(createConfig({ presenceDiscordClientId: " config-id " }), {
        KUNAI_DISCORD_CLIENT_ID: "env-id",
      }),
    ).toBe("config-id");
    expect(
      resolvePresenceClientId(createConfig({ presenceDiscordClientId: "" }), {
        KUNAI_DISCORD_CLIENT_ID: " env-id ",
      }),
    ).toBe("env-id");
    expect(resolvePresenceClientId(createConfig({ presenceDiscordClientId: "" }), {})).toBe(
      "1502307419047461025",
    );
    expect(
      resolvePresenceClientIdSource(
        createConfig({ presenceProvider: "discord", presenceDiscordClientId: "config-id" }),
        {},
      ),
    ).toBe("config");
    expect(
      resolvePresenceClientIdSource(createConfig({ presenceProvider: "discord" }), {
        KUNAI_DISCORD_CLIENT_ID: "env-id",
      }),
    ).toBe("environment");
  });

  test("builds user-facing presence status snapshots", () => {
    expect(
      buildPresenceSnapshot({
        provider: "off",
        status: "idle",
        privacy: "full",
        clientIdSource: "config",
        unavailableUntilRestart: false,
      }),
    ).toMatchObject({ status: "disabled", detail: "off", canConnect: false });

    expect(
      buildPresenceSnapshot({
        provider: "discord",
        status: "ready",
        privacy: "private",
        clientIdSource: "config",
        unavailableUntilRestart: false,
      }),
    ).toMatchObject({
      status: "ready",
      detail: "connected to local Discord client",
      canConnect: true,
    });
  });
});
