import { describe, expect, test } from "bun:test";

import { DETACHED_HANDOFF_CAPABILITIES } from "@/domain/playback/player-capabilities";
import type { StreamInfo } from "@/domain/types";
import type { AndroidIntentRuntime } from "@/infra/player/android-intent-launcher";
import { HandoffPlaybackError, HandoffPlayerService } from "@/infra/player/handoff-player-service";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

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

  test("rejects unsupported stream requirements before spawning", async () => {
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
      { ...STREAM, headers: { Cookie: "secret=1" }, subtitle: "https://subs.example/a.vtt" },
      { url: STREAM.url, displayTitle: "Example" },
    );
    expect(attempt).rejects.toBeInstanceOf(HandoffPlaybackError);
    expect(attempt).rejects.toMatchObject({
      reason: "unsupported-stream",
      blockers: ["cookies-required", "external-subtitle-unsupported"],
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
