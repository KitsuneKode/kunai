import { afterEach, describe, expect, test } from "bun:test";

import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { resolveTuning } from "@/services/persistence/tuning";
import {
  __testing as presenceTesting,
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
    tuning: resolveTuning(raw.tuningOverrides),
    getRaw: () => ({ ...raw }),
    update: async () => undefined,
    applySessionOverrides: () => undefined,
    save: async () => undefined,
    flushPending: async () => undefined,
    reset: async () => undefined,
  };
}

function createDiagnostics(): DiagnosticsStore & {
  messages: string[];
  events: Parameters<DiagnosticsStore["record"]>[0][];
} {
  const messages: string[] = [];
  const events: Parameters<DiagnosticsStore["record"]>[0][] = [];
  return {
    messages,
    events,
    record: (event) => {
      events.push(event);
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
  const originalCreateDiscordClient = presenceTesting.runtime.createDiscordClient;

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
    presenceTesting.runtime.createDiscordClient = originalCreateDiscordClient;
  });

  test("stays disabled by default", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "off" }),
      diagnostics: diagnostics,
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
      title: {
        id: "1",
        type: "series" as const,
        name: "Breaking Bad",
        posterUrl: "https://image.example/breaking-bad.jpg",
      },
      episode: { season: 4, episode: 9 },
      providerId: "vidking",
      startedAtMs: 1000,
      positionSeconds: 120,
      durationSeconds: 1500,
    };

    expect(buildDiscordActivity(activity, "full")).toMatchObject({
      details: "Breaking Bad",
      type: 3,
    });
    expect(String(buildDiscordActivity(activity, "full").state)).toContain("S4 E9");
    expect(buildDiscordActivity(activity, "full").playable_ref).toContain("kunai://play?");
    expect(buildDiscordActivity(activity, "full").buttons).toBeUndefined();
    expect(buildDiscordActivity(activity, "private")).toMatchObject({
      details: "Watching with Kunai",
      state: "Playing",
      type: 3,
      assets: { large_image: "kunai", large_text: "Kunai" },
    });
    expect(buildDiscordActivity(activity, "private").buttons).toBeUndefined();
    expect(buildDiscordActivity(activity, "private")).not.toHaveProperty("timestamps");
    expect(JSON.stringify(buildDiscordActivity(activity, "private"))).not.toContain("Breaking Bad");
    expect(JSON.stringify(buildDiscordActivity(activity, "private"))).not.toContain(
      "image.example",
    );
  });

  test("uses Discord IPC activity shape instead of discord-rpc npm aliases", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Demo" },
      episode: { season: 1, episode: 1 },
      providerId: "vidking",
      startedAtMs: 1_000,
      positionSeconds: 30,
      durationSeconds: 600,
    };
    const payload = buildDiscordActivity(activity, "full");

    expect(payload).not.toHaveProperty("startTimestamp");
    expect(payload).not.toHaveProperty("endTimestamp");
    expect(payload).not.toHaveProperty("largeImageKey");
    expect(payload).not.toHaveProperty("largeImageText");
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
        timestamps: { start: 880, end: 2380 },
        assets: { large_image: "kunai" },
      });
      expect(buildDiscordActivity(activity, "full").assets).toMatchObject({
        large_image: "kunai",
        large_text: "Breaking Bad",
      });
    } finally {
      Date.now = realDateNow;
    }
  });

  test("adds catalog links and safe poster art to full presence", () => {
    const activity = {
      mode: "anime" as const,
      title: {
        id: "anilist:154587",
        type: "series" as const,
        name: "Frieren: Beyond Journey's End",
        externalIds: { anilistId: "154587" },
        posterUrl: "https://image.example/frieren.jpg",
      },
      episode: { season: 1, episode: 14, name: "Smells Like Trouble" },
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
      details_url: "https://anilist.co/anime/154587",
      state_url: "https://anilist.co/anime/154587",
      buttons: [{ label: "View on AniList", url: "https://anilist.co/anime/154587" }],
      assets: {
        large_image: "https://image.example/frieren.jpg",
        large_text: "Frieren: Beyond Journey's End",
        large_url: "https://anilist.co/anime/154587",
      },
    });
    expect(String(payload.state)).toContain("S1 E14 · Smells Like Trouble");
    expect(payload).not.toHaveProperty("largeImageKey");
    expect(payload).not.toHaveProperty("smallImageKey");
    expect(JSON.stringify(payload)).not.toContain("signed-provider.example");
  });

  test("adds catalog buttons when ids are known", () => {
    const activity = {
      mode: "series" as const,
      title: {
        id: "tmdb:1396",
        type: "series" as const,
        name: "Breaking Bad",
        externalIds: { tmdbId: "1396" },
      },
      episode: { season: 4, episode: 9 },
      providerId: "vidking",
      startedAtMs: 1000,
    };

    expect(buildDiscordActivity(activity, "full").buttons).toEqual([
      {
        label: "View episode on TMDB",
        url: "https://www.themoviedb.org/tv/1396/season/4/episode/9",
      },
    ]);
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

    const payload = buildDiscordActivity(activity, "full");
    expect(payload.details).toBe("Breaking Bad");
    expect(String(payload.state)).toContain("S4 E9");
    const timestamps = payload.timestamps as { start: number; end: number };
    expect(timestamps.end - timestamps.start).toBe(1440);
    expect(payload).not.toHaveProperty("small_image");
  });

  test("falls back to paused text when duration is unknown", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Breaking Bad" },
      episode: { season: 4, episode: 9 },
      providerId: "vidking",
      startedAtMs: 1000,
      positionSeconds: 120,
      paused: true,
    };

    expect(buildDiscordActivity(activity, "full")).toMatchObject({
      timestamps: null,
    });
    expect(String(buildDiscordActivity(activity, "full").state)).toContain(
      "S4 E9 · Paused at 2:00",
    );
  });

  test("includes episode numbers even when the episode has a title", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Love Your Enemy" },
      episode: { season: 1, episode: 5, name: "Jiwon&Jiwon" },
      providerId: "vidking",
      startedAtMs: 1000,
    };

    expect(String(buildDiscordActivity(activity, "full").state)).toContain("S1 E5 · Jiwon&Jiwon");
  });

  test("appends binge session suffix after the configured threshold", () => {
    const activity = {
      mode: "series" as const,
      title: { id: "1", type: "series" as const, name: "Breaking Bad" },
      episode: { season: 4, episode: 9, name: "Bug" },
      providerId: "vidking",
      startedAtMs: 1000,
      positionSeconds: 120,
      durationSeconds: 1500,
    };

    expect(
      String(
        buildDiscordActivity(activity, "full", {
          sessionElapsedMs: 14 * 60_000,
          sessionShowAfterMs: 15 * 60_000,
        }).state,
      ),
    ).toContain("S4 E9 · Bug");

    expect(
      String(
        buildDiscordActivity(activity, "full", {
          sessionElapsedMs: 46 * 60_000,
          sessionShowAfterMs: 15 * 60_000,
        }).state,
      ),
    ).toContain("S4 E9 · Bug");
    expect(
      String(
        buildDiscordActivity(activity, "full", {
          sessionElapsedMs: 46 * 60_000,
          sessionShowAfterMs: 15 * 60_000,
        }).state,
      ),
    ).toContain("46m with Kunai");
  });

  test("clearPlayback resets dedupe hash and watch session state", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord" }),
      diagnostics,
    });
    const calls: string[] = [];

    Object.assign(service as unknown as Record<string, unknown>, {
      discordClient: {
        async login() {},
        async setActivity() {},
        async clearActivity() {
          calls.push("clear");
        },
        async destroy() {},
        on() {},
      },
      lastActivityHash: "stale-hash",
      lastActivityPayload: { details: "Still visible" },
      watchSessionStartedAtMs: Date.now(),
      watchSessionPausedTotalMs: 12_000,
      status: "ready",
    });

    await service.clearPlayback("test-clear");

    expect(calls).toEqual(["clear"]);
    expect((service as unknown as { lastActivityHash: string | null }).lastActivityHash).toBeNull();
    expect(
      (service as unknown as { watchSessionStartedAtMs: number | null }).watchSessionStartedAtMs,
    ).toBeNull();
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
      diagnostics: diagnostics,
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

  test("connects through Bun-native Discord IPC without a Node bridge", async () => {
    const diagnostics = createDiagnostics();
    const loginCalls: string[] = [];

    const fakeDiscordClient = {
      async login(input: { clientId: string }) {
        loginCalls.push(`ipc:${input.clientId}`);
      },
      async setActivity() {},
      async clearActivity() {},
      async destroy() {},
      on() {},
    };

    presenceTesting.runtime.createDiscordClient = () => fakeDiscordClient;

    const service = new PresenceServiceImpl({
      config: createConfig({
        presenceProvider: "discord",
        presenceDiscordClientId: "bun-client-id",
      }),
      diagnostics: diagnostics,
    });

    const snapshot = await service.connect();

    expect(snapshot.status).toBe("ready");
    expect(loginCalls).toEqual(["ipc:bun-client-id"]);
    expect(diagnostics.events.at(-1)).toMatchObject({
      category: "presence",
      message: "Discord presence connected",
      context: { provider: "discord", transport: "bun-discord-ipc" },
    });
  });

  test("shutdown clears Discord activity before destroying the client", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord" }),
      diagnostics: diagnostics,
    });
    const calls: string[] = [];

    Object.assign(service as unknown as Record<string, unknown>, {
      discordClient: {
        async login() {},
        async setActivity() {},
        async clearActivity() {
          calls.push("clear");
        },
        async destroy() {
          calls.push("destroy");
        },
        on() {},
      },
      lastActivityHash: "activity-hash",
      lastActivityPayload: { details: "Still visible" },
      status: "ready",
    });

    await service.shutdown();

    expect(calls).toEqual(["clear", "destroy"]);
    expect(diagnostics.messages).toContain("Presence cleared");
    expect(service.getStatus()).toBe("idle");
  });

  test("ignores playback updates after shutdown begins", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord" }),
      diagnostics: diagnostics,
    });
    const setActivityCalls: unknown[] = [];

    Object.assign(service as unknown as Record<string, unknown>, {
      discordClient: {
        async login() {},
        async setActivity(payload: unknown) {
          setActivityCalls.push(payload);
        },
        async clearActivity() {},
        async destroy() {},
        on() {},
      },
      status: "ready",
    });

    await service.shutdown();
    await service.updatePlayback({
      mode: "series",
      title: { id: "tmdb:1", type: "series", name: "Demo" },
      episode: { season: 1, episode: 1 },
      providerId: "videasy",
      stream: { url: "https://cdn.example/stream.mp4", headers: {}, timestamp: 1 },
      startedAtMs: Date.now(),
      positionSeconds: 0,
    });

    expect(setActivityCalls).toEqual([]);
  });

  test("shutdown clears a Discord client that finishes connecting during exit", async () => {
    const diagnostics = createDiagnostics();
    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord" }),
      diagnostics: diagnostics,
    });
    const calls: string[] = [];
    const client = {
      async login() {},
      async setActivity() {
        calls.push("set");
      },
      async clearActivity() {
        calls.push("clear");
      },
      async destroy() {
        calls.push("destroy");
      },
      on() {},
    };

    Object.assign(service as unknown as Record<string, unknown>, {
      connectPromise: Promise.resolve(client),
      lastActivityHash: "activity-hash",
      lastActivityPayload: { details: "Connecting while exiting" },
      status: "connecting",
    });

    await service.shutdown();

    expect(calls).toEqual(["clear", "destroy"]);
    expect(service.getStatus()).toBe("idle");
  });

  test("reports unavailable when Discord IPC cannot connect", async () => {
    const diagnostics = createDiagnostics();
    presenceTesting.runtime.createDiscordClient = () => {
      throw new Error("Could not connect to Discord IPC");
    };

    const service = new PresenceServiceImpl({
      config: createConfig({ presenceProvider: "discord" }),
      diagnostics: diagnostics,
    });

    const snapshot = await service.connect();

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.detail).toContain("Could not connect to Discord IPC");
    expect(diagnostics.messages).toContain("Discord presence unavailable");
  });
});
