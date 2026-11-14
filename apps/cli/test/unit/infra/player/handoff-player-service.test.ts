import { describe, expect, test } from "bun:test";

import { DETACHED_HANDOFF_CAPABILITIES } from "@/domain/playback/player-capabilities";
import type { StreamInfo } from "@/domain/types";
import type { AndroidIntentRuntime } from "@/infra/player/android-intent-launcher";
import { HandoffPlaybackError, HandoffPlayerService } from "@/infra/player/handoff-player-service";
import { getSharedStreamGateway, stopSharedStreamGateway } from "@/infra/player/stream-gateway";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { registerAllMangaAkDeferredDescriptor } from "@kunai/providers";

const STREAM: StreamInfo = {
  url: "https://media.example/episode.m3u8",
  headers: {},
  timestamp: 1,
};

function runtime(exitCode = 0, stderr = ""): AndroidIntentRuntime {
  return {
    which: (command) => (command === "termux-am" ? "/usr/bin/termux-am" : null),
    spawn: () => ({
      exited: Promise.resolve(exitCode),
      stdout: new Response("").body,
      stderr: new Response(stderr).body,
    }),
  };
}

describe("HandoffPlayerService", () => {
  test("cancelling a headered handoff releases its gateway and never reports acceptance", async () => {
    const controller = new AbortController();
    const gateway = getSharedStreamGateway();
    const player = new HandoffPlayerService({
      target: "vlc",
      runtime: {
        ...runtime(),
        spawn: () => {
          controller.abort();
          return { exited: Promise.resolve(0) };
        },
      },
    });
    try {
      await expect(
        player.play(
          { ...STREAM, headers: { Referer: "https://provider.example/" } },
          {
            url: STREAM.url,
            displayTitle: "Example",
            abortSignal: controller.signal,
          },
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(gateway.isStopped()).toBe(true);
      // Cancelling this request must not poison the service's next handoff.
      const retry = await player.play(STREAM, { url: STREAM.url, displayTitle: "Retry" });
      expect(retry.handoff?.accepted).toBe(true);
    } finally {
      stopSharedStreamGateway();
    }
  });

  test("shutdown cancels an in-flight launch rather than returning accepted", async () => {
    const player = new HandoffPlayerService({
      target: "vlc",
      runtime: {
        ...runtime(),
        spawn: () => {
          player.beginShutdown();
          return { exited: Promise.resolve(0) };
        },
      },
    });
    await expect(
      player.play(STREAM, { url: STREAM.url, displayTitle: "Example" }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("advertises detached capabilities and returns only accepted handoff evidence", async () => {
    const player = new HandoffPlayerService({ target: "vlc", runtime: runtime() });
    const events: string[] = [];
    let ready = 0;
    let generations = 0;
    let progress = 0;

    const result = await player.play(STREAM, {
      url: STREAM.url,
      displayTitle: "Example episode",
      onPlayerReady: () => ready++,
      onGenerationActivated: () => generations++,
      onProgress: () => progress++,
      onPlaybackEvent: ({ event }) => events.push(event.type),
    });

    expect(player.capabilities).toBe(DETACHED_HANDOFF_CAPABILITIES);
    expect(result).toEqual({
      watchedSeconds: 0,
      duration: 0,
      endReason: "unknown",
      resultSource: "handoff",
      handoff: { accepted: true, player: "vlc", launcher: "termux-am" },
    });
    expect({ events, ready, generations, progress }).toEqual({
      events: [],
      ready: 0,
      generations: 0,
      progress: 0,
    });
  });

  test("the stream gateway hands a localhost URL with subtitle extras for headered streams", async () => {
    let argv: readonly string[] | undefined;
    const player = new HandoffPlayerService({
      target: "vlc",
      runtime: {
        ...runtime(),
        spawn: (a) => {
          argv = a;
          return { exited: Promise.resolve(0) };
        },
      },
    });
    try {
      const result = await player.play(
        {
          ...STREAM,
          headers: { Cookie: "secret=1", Referer: "https://provider.example/" },
          subtitle: "https://subs.example/a.vtt",
        },
        { url: STREAM.url, displayTitle: "Example" },
      );
      expect(result.handoff?.accepted).toBe(true);
      const data = argv?.find((a) => a.startsWith("http"));
      // The intent carries the gateway URL, never the provider URL.
      expect(data).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/g\/[0-9a-f]{32}\/media$/);
      // VLC gets the gateway subtitle extra, not the raw provider URL.
      const subIndex = argv?.indexOf("subtitles_location") ?? -1;
      expect(subIndex).toBeGreaterThan(-1);
      expect(argv?.[subIndex + 1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/g\/[0-9a-f]{32}\/sub\/0$/);
    } finally {
      stopSharedStreamGateway();
    }
  });

  test("headerless streams still hand the provider URL directly", async () => {
    let argv: readonly string[] | undefined;
    const player = new HandoffPlayerService({
      target: "chooser",
      runtime: {
        ...runtime(),
        spawn: (a) => {
          argv = a;
          return { exited: Promise.resolve(0) };
        },
      },
    });
    await player.play(STREAM, { url: STREAM.url, displayTitle: "Example" });
    expect(argv).toContain(STREAM.url);
  });

  test("chooser rejects external subtitles instead of silently dropping them", async () => {
    let spawned = false;
    const player = new HandoffPlayerService({
      target: "chooser",
      runtime: {
        ...runtime(),
        spawn: () => {
          spawned = true;
          return { exited: Promise.resolve(0) };
        },
      },
    });
    try {
      await expect(
        player.play(
          { ...STREAM, subtitle: "https://subs.example/a.vtt" },
          {
            url: STREAM.url,
            displayTitle: "Example",
          },
        ),
      ).rejects.toMatchObject({
        reason: "unsupported-stream",
        blockers: ["external-subtitle-unsupported"],
      });
      expect(spawned).toBe(false);
    } finally {
      stopSharedStreamGateway();
    }
  });

  test("a deferred locator is served through the gateway document route", async () => {
    const locator = registerAllMangaAkDeferredDescriptor({
      duration: 100,
      video: { url: "https://ak-video.example/v.mp4?sig=x", mimeType: "video/mp4" },
      audio: { url: "https://ak-audio.example/a.mp4?sig=x", mimeType: "audio/mp4" },
    });
    let argv: readonly string[] | undefined;
    const player = new HandoffPlayerService({
      target: "mpv",
      runtime: {
        ...runtime(),
        spawn: (a) => {
          argv = a;
          return { exited: Promise.resolve(0) };
        },
      },
    });
    try {
      const result = await player.play(
        { ...STREAM, url: locator, deferredLocator: locator },
        { url: locator, displayTitle: "Deferred" },
      );
      expect(result.handoff?.accepted).toBe(true);
      const data = argv?.find((a) => a.startsWith("http"));
      expect(data).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/g\/[0-9a-f]{32}\/doc$/);
    } finally {
      stopSharedStreamGateway();
    }
  });

  test("an expired deferred locator still rejects as deferred-source", async () => {
    const player = new HandoffPlayerService({ target: "chooser", runtime: runtime() });
    await expect(
      player.play(
        { ...STREAM, url: "allmanga-ak:gone", deferredLocator: "allmanga-ak:gone" },
        { url: "allmanga-ak:gone", displayTitle: "Expired" },
      ),
    ).rejects.toMatchObject({
      reason: "unsupported-stream",
      blockers: ["deferred-source", "unsupported-scheme"],
    });
  });

  test("still rejects what the gateway cannot carry", async () => {
    let spawned = false;
    const player = new HandoffPlayerService({
      target: "chooser",
      runtime: {
        ...runtime(),
        spawn: () => {
          spawned = true;
          return { exited: Promise.resolve(0) };
        },
      },
    });

    const attempt = player.play(
      { ...STREAM, requiresYtdl: true },
      { url: STREAM.url, displayTitle: "Example" },
    );
    expect(attempt).rejects.toBeInstanceOf(HandoffPlaybackError);
    expect(attempt).rejects.toMatchObject({
      reason: "unsupported-stream",
      blockers: ["yt-dlp-required"],
    });
    await attempt.catch(() => undefined);
    expect(spawned).toBe(false);
  });

  test("surfaces typed launcher and package failures", async () => {
    const missingLauncher = new HandoffPlayerService({
      target: "chooser",
      runtime: { which: () => null, spawn: () => ({ exited: Promise.resolve(0) }) },
    });
    expect(
      missingLauncher.play(STREAM, { url: STREAM.url, displayTitle: "Example" }),
    ).rejects.toMatchObject({ reason: "intent-launcher-missing" });

    const missingVlc = new HandoffPlayerService({
      target: "vlc",
      runtime: runtime(1, "Error type 3: Activity class does not exist"),
    });
    expect(
      missingVlc.play(STREAM, { url: STREAM.url, displayTitle: "Example" }),
    ).rejects.toMatchObject({ reason: "player-not-installed" });
  });

  test("reports launcher availability and keeps process lifecycle methods deterministic", async () => {
    const player = new HandoffPlayerService({ target: "chooser", runtime: runtime() });
    expect(await player.isAvailable()).toBe(true);
    expect(await player.releasePersistentSession()).toBeUndefined();
    expect(player.killActiveMpvProcessesSync()).toBeUndefined();
    player.beginShutdown();
    expect(player.play(STREAM, { url: STREAM.url, displayTitle: "Example" })).rejects.toMatchObject(
      {
        reason: "player-shutting-down",
      },
    );
  });

  test("fails local playback explicitly", async () => {
    const player = new HandoffPlayerService({ target: "mpv", runtime: runtime() });
    const source = {
      kind: "local",
      jobId: "job-1",
      titleId: "title-1",
      titleName: "Example",
      mediaKind: "movie",
      providerId: "provider",
      filePath: "/tmp/example.mkv",
    } satisfies LocalPlaybackSource;

    expect(player.playLocal({ source })).rejects.toMatchObject({
      reason: "local-source-unsupported",
    });
  });
});
