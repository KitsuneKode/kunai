import { afterEach, describe, expect, test } from "bun:test";

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
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalDateNow = Date.now;

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
  });

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
      details: "Breaking Bad",
      state: "S4 E9 · vidking",
      type: 3,
      buttons: [{ label: "Get Kunai", url: "https://github.com/KitsuneKode/kunai" }],
    });
    expect(buildDiscordActivity(activity, "private")).toMatchObject({
      details: "Watching with Kunai",
      state: "Playing",
      type: 3,
      buttons: [{ label: "Get Kunai", url: "https://github.com/KitsuneKode/kunai" }],
    });
  });

  test("builds Discord media timestamps from playback progress", () => {
    const realDateNow = Date.now;
    Date.now = () => 1_000_000;
    try {
      const activity = {
        mode: "series" as const,
        title: { id: "1", type: "series" as const, name: "Breaking Bad" },
        episode: { season: 4, episode: 9 },
        providerId: "vidking",
        startedAtMs: 1000,
        positionSeconds: 120,
        durationSeconds: 1500,
      };

      expect(buildDiscordActivity(activity, "full")).toMatchObject({
        startTimestamp: 880,
        endTimestamp: 2380,
      });
    } finally {
      Date.now = realDateNow;
    }
  });

  test("adds exact progress, media facts, and a safe action button to full presence", () => {
    const activity = {
      mode: "anime" as const,
      title: { id: "1", type: "series" as const, name: "Frieren: Beyond Journey's End" },
      episode: { season: 1, episode: 14 },
      providerId: "allanime",
      startedAtMs: 1000,
      positionSeconds: 734,
      durationSeconds: 1440,
      subtitleCount: 2,
      stream: {
        url: "https://signed-provider.example/video.m3u8",
        headers: { Referer: "https://provider.example/" },
        subtitle: "https://signed-provider.example/subs-en.vtt",
        timestamp: 1,
        providerResolveResult: {
          status: "resolved" as const,
          providerId: "allanime",
          selectedStreamId: "stream-1080",
          streams: [
            {
              id: "stream-1080",
              providerId: "allanime",
              sourceId: "source-a",
              url: "https://signed-provider.example/video.m3u8",
              protocol: "hls" as const,
              container: "m3u8" as const,
              presentation: "sub" as const,
              qualityLabel: "1080p",
              audioLanguages: ["ja"],
              headers: {},
              confidence: 1,
              cachePolicy: {
                ttlClass: "stream-manifest" as const,
                scope: "local" as const,
                keyParts: [],
              },
            },
          ],
          subtitles: [
            {
              id: "sub-en",
              providerId: "allanime",
              sourceId: "source-a",
              url: "https://signed-provider.example/subs-en.vtt",
              language: "en",
              source: "provider" as const,
              confidence: 1,
              cachePolicy: {
                ttlClass: "subtitle-list" as const,
                scope: "local" as const,
                keyParts: [],
              },
            },
          ],
          trace: {
            id: "trace-1",
            startedAt: "2026-01-01T00:00:00.000Z",
            cacheHit: false,
            title: { id: "1", kind: "series" as const, title: "Frieren" },
            steps: [],
            failures: [],
          },
          failures: [],
        },
      },
    };

    const payload = buildDiscordActivity(activity, "full");

    expect(payload).toMatchObject({
      details: "Frieren: Beyond Journey's End",
      state: "S1 E14 · 12:14 / 24:00 · 1080p · sub · ja audio · en subs · allanime",
      buttons: [{ label: "Get Kunai", url: "https://github.com/KitsuneKode/kunai" }],
    });
    expect(payload).not.toHaveProperty("smallImageKey");
    expect(payload).not.toHaveProperty("smallImageText");
    expect(JSON.stringify(payload)).not.toContain("signed-provider.example");
  });

  test("adds opt-in Discord handoff button only for safe URLs", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Demo" },
      episode: { season: 1, episode: 2 },
      providerId: "vidking",
      startedAtMs: 1000,
    };

    expect(
      buildDiscordActivity(activity, "full", { openUrl: "kunai://play/current" }),
    ).toMatchObject({
      buttons: [
        { label: "Open in Kunai", url: "kunai://play/current" },
        { label: "Get Kunai", url: "https://github.com/KitsuneKode/kunai" },
      ],
    });
    expect(
      buildDiscordActivity(activity, "full", { openUrl: "javascript:alert(1)" }),
    ).toMatchObject({
      buttons: [{ label: "Get Kunai", url: "https://github.com/KitsuneKode/kunai" }],
    });
  });

  test("shows paused progress without an advancing Discord timer", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Breaking Bad" },
      episode: { season: 4, episode: 9 },
      providerId: "vidking",
      startedAtMs: 1000,
      positionSeconds: 734,
      durationSeconds: 1440,
      paused: true,
    };

    expect(buildDiscordActivity(activity, "full")).toMatchObject({
      details: "Breaking Bad",
      state: "S4 E9 · Paused at 12:14 / 24:00 · vidking",
    });
    expect(buildDiscordActivity(activity, "full")).not.toHaveProperty("startTimestamp");
    expect(buildDiscordActivity(activity, "full")).not.toHaveProperty("endTimestamp");
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

  test("browsing updates honor elapsed reconnect backoff and start heartbeat", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord" }),
      diagnosticsStore: diagnostics,
    });
    const activities: Record<string, unknown>[] = [];
    let intervalCount = 0;
    globalThis.setInterval = ((_callback: (...args: unknown[]) => void) => {
      intervalCount += 1;
      return intervalCount as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;
    Date.now = () => 10_000;

    Object.assign(service as unknown as Record<string, unknown>, {
      discordClient: {
        async login() {},
        async setActivity(activity: Record<string, unknown>) {
          activities.push(activity);
        },
        async clearActivity() {},
        async destroy() {},
        on() {},
      },
      unavailableUntilRestart: true,
      unavailableRetryAtMs: 9_000,
    });

    await service.updateBrowsing({ view: "discover", detail: "Trending" });

    expect(service.getStatus()).toBe("ready");
    expect(activities).toHaveLength(1);
    expect(intervalCount).toBe(1);
    expect(service.getSnapshot().detail).toBe("connected to local Discord client");
  });
});
