import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AndroidIntentRuntime } from "@/infra/player/android-intent-launcher";
import { HandoffPlayerService } from "@/infra/player/handoff-player-service";
import { stopSharedStreamGateway } from "@/infra/player/stream-gateway";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

const roots: string[] = [];
afterEach(async () => {
  stopSharedStreamGateway();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kunai-local-handoff-"));
  roots.push(root);
  const source: LocalPlaybackSource = {
    kind: "local",
    jobId: "job",
    titleId: "title",
    titleName: "Example",
    mediaKind: "movie",
    providerId: "fixture",
    filePath: join(root, "movie.mp4"),
    subtitlePath: join(root, "movie.vtt"),
  };
  await Bun.write(source.filePath, "local-media");
  await Bun.write(source.subtitlePath!, "WEBVTT\n");
  return source;
}

function runtime(spawn: AndroidIntentRuntime["spawn"]): AndroidIntentRuntime {
  return { which: (command) => (command === "termux-am" ? "/fake/termux-am" : null), spawn };
}

test.each(["mpv", "vlc"] as const)(
  "local %s handoff keeps media and subtitle alive after acceptance",
  async (target) => {
    const source = await fixture();
    let argv: readonly string[] = [];
    const player = new HandoffPlayerService({
      target,
      runtime: runtime((value) => {
        argv = value;
        return { exited: Promise.resolve(0) };
      }),
    });
    const result = await player.playLocal({ source });
    expect(result.handoff).toMatchObject({ accepted: true, player: target });
    expect(result.resultSource).toBe("handoff");
    expect(result.watchedSeconds).toBe(0);
    expect(argv).toContain(target === "vlc" ? "org.videolan.vlc" : "is.xyz.mpv");
    expect(argv).not.toContain(source.filePath);
    const media = argv[argv.indexOf("-d") + 1]!;
    expect(await (await fetch(media)).text()).toBe("local-media");
    const sub = argv[argv.indexOf(target === "vlc" ? "subtitles_location" : "subs") + 1]!;
    expect(await (await fetch(sub)).text()).toBe("WEBVTT\n");
    await player.releasePersistentSession();
    expect((await fetch(media)).status).toBe(200);
    player.beginShutdown();
    await expect(fetch(media)).rejects.toThrow();
    await expect(player.playLocal({ source })).rejects.toMatchObject({
      reason: "player-shutting-down",
    });
  },
);

test("chooser supports local video but refuses a sidecar it cannot attach", async () => {
  const source = await fixture();
  let launches = 0;
  const player = new HandoffPlayerService({
    target: "chooser",
    runtime: runtime(() => {
      launches++;
      return { exited: Promise.resolve(0) };
    }),
  });
  await expect(player.playLocal({ source })).rejects.toMatchObject({
    reason: "unsupported-stream",
    blockers: ["external-subtitle-unsupported"],
  });
  expect(launches).toBe(0);
  expect(
    (await player.playLocal({ source: { ...source, subtitlePath: undefined } })).handoff?.accepted,
  ).toBe(true);
});

test("the normal offline playback lane uses the verified source and rejects path substitution", async () => {
  const source = await fixture();
  let launches = 0;
  let media = "";
  const player = new HandoffPlayerService({
    target: "mpv",
    runtime: runtime((argv) => {
      launches++;
      media = argv[argv.indexOf("-d") + 1]!;
      return { exited: Promise.resolve(0) };
    }),
  });
  await player.play(
    { url: source.filePath, headers: {}, timestamp: 1, subtitle: source.subtitlePath },
    {
      url: source.filePath,
      displayTitle: "Offline",
      localPlaybackSource: source,
    },
  );
  expect(await (await fetch(media)).text()).toBe("local-media");
  await expect(
    player.play(
      { url: join(roots[0]!, "other.mp4"), headers: {}, timestamp: 1 },
      {
        url: source.filePath,
        displayTitle: "Wrong",
        localPlaybackSource: source,
      },
    ),
  ).rejects.toMatchObject({ reason: "unsupported-stream", blockers: ["local-source-unsupported"] });
  expect(launches).toBe(1);
});

test("cancelled local launch revokes its URL and permits a clean retry", async () => {
  const source = await fixture();
  const controller = new AbortController();
  const urls: string[] = [];
  const player = new HandoffPlayerService({
    target: "vlc",
    runtime: runtime((argv) => {
      urls.push(argv[argv.indexOf("-d") + 1]!);
      if (urls.length === 1) controller.abort();
      return { exited: Promise.resolve(0) };
    }),
  });
  const stream = { url: source.filePath, headers: {}, timestamp: 1 };
  await expect(
    player.play(stream, {
      url: source.filePath,
      displayTitle: "Offline",
      localPlaybackSource: source,
      abortSignal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect((await fetch(urls[0]!)).status).toBe(404);
  expect((await player.playLocal({ source })).handoff?.accepted).toBe(true);
  expect(await (await fetch(urls[1]!)).text()).toBe("local-media");
});

test("failed local launch revokes only its token and retry replaces the prior playback", async () => {
  const source = await fixture();
  const urls: string[] = [];
  const player = new HandoffPlayerService({
    target: "mpv",
    runtime: runtime((argv) => {
      urls.push(argv[argv.indexOf("-d") + 1]!);
      return { exited: Promise.resolve(urls.length === 1 ? 1 : 0) };
    }),
  });
  await expect(player.playLocal({ source })).rejects.toMatchObject({ reason: "launch-rejected" });
  expect((await fetch(urls[0]!)).status).toBe(404);
  await player.playLocal({ source });
  await player.playLocal({ source });
  expect((await fetch(urls[1]!)).status).toBe(404);
  expect(await (await fetch(urls[2]!)).text()).toBe("local-media");
});

test("an accepted local handoff is revoked by its own cancellation without stopping the gateway", async () => {
  const source = await fixture();
  const controller = new AbortController();
  let media = "";
  const player = new HandoffPlayerService({
    target: "mpv",
    runtime: runtime((argv) => {
      media = argv[argv.indexOf("-d") + 1]!;
      return { exited: Promise.resolve(0) };
    }),
  });
  await player.play(
    { url: source.filePath, headers: {}, timestamp: 1 },
    {
      url: source.filePath,
      displayTitle: "Offline",
      localPlaybackSource: source,
      abortSignal: controller.signal,
    },
  );
  expect(await (await fetch(media)).text()).toBe("local-media");
  controller.abort();
  expect((await fetch(media)).status).toBe(404);
});

test("a superseded remote launch cannot stop a successor local handoff", async () => {
  const source = await fixture();
  const spawned = Promise.withResolvers<void>();
  const previousExit = Promise.withResolvers<number>();
  const urls: string[] = [];
  const player = new HandoffPlayerService({
    target: "vlc",
    runtime: runtime((argv) => {
      urls.push(argv[argv.indexOf("-d") + 1]!);
      if (urls.length === 1) {
        spawned.resolve();
        return { exited: previousExit.promise };
      }
      return { exited: Promise.resolve(0) };
    }),
  });
  const previous = player.play(
    {
      url: "https://media.example.test/old.mp4",
      headers: { Referer: "https://provider.example.test" },
      timestamp: 1,
    },
    {
      url: "https://media.example.test/old.mp4",
      displayTitle: "Previous",
    },
  );
  // Attach the rejection witness before the successor cancels this pending launch.
  const previousOutcome = previous.then(
    () => null,
    (error: Error) => error,
  );
  await spawned.promise;
  await player.playLocal({ source });
  previousExit.resolve(1);
  expect(await previousOutcome).toMatchObject({ name: "AbortError" });
  expect((await fetch(urls[0]!)).status).toBe(404);
  expect(await (await fetch(urls[1]!)).text()).toBe("local-media");
});

test("cancelling a superseded accepted handoff never revokes the successor", async () => {
  const source = await fixture();
  const controller = new AbortController();
  const urls: string[] = [];
  const player = new HandoffPlayerService({
    target: "mpv",
    runtime: runtime((argv) => {
      urls.push(argv[argv.indexOf("-d") + 1]!);
      return { exited: Promise.resolve(0) };
    }),
  });
  await player.play(
    { url: source.filePath, headers: {}, timestamp: 1 },
    {
      url: source.filePath,
      displayTitle: "Offline",
      localPlaybackSource: source,
      abortSignal: controller.signal,
    },
  );
  await player.playLocal({ source });
  controller.abort();
  expect((await fetch(urls[0]!)).status).toBe(404);
  expect(await (await fetch(urls[1]!)).text()).toBe("local-media");
});

test("chooser checks the verified local sidecar even when the stream omitted its subtitle field", async () => {
  const source = await fixture();
  let launches = 0;
  const player = new HandoffPlayerService({
    target: "chooser",
    runtime: runtime(() => {
      launches++;
      return { exited: Promise.resolve(0) };
    }),
  });
  await expect(
    player.play(
      { url: source.filePath, headers: {}, timestamp: 1 },
      {
        url: source.filePath,
        displayTitle: "Offline",
        localPlaybackSource: source,
      },
    ),
  ).rejects.toMatchObject({
    reason: "unsupported-stream",
    blockers: ["external-subtitle-unsupported"],
  });
  expect(launches).toBe(0);
});

test("switching from local media to a direct remote URL revokes the local token", async () => {
  const source = await fixture();
  const urls: string[] = [];
  const player = new HandoffPlayerService({
    target: "vlc",
    runtime: runtime((argv) => {
      urls.push(argv[argv.indexOf("-d") + 1]!);
      return { exited: Promise.resolve(0) };
    }),
  });
  await player.playLocal({ source });
  const remote = "https://media.example.test/next.mp4";
  await player.play(
    { url: remote, headers: {}, timestamp: 1 },
    { url: remote, displayTitle: "Remote" },
  );
  expect(urls[1]).toBe(remote);
  expect((await fetch(urls[0]!)).status).toBe(404);
});
