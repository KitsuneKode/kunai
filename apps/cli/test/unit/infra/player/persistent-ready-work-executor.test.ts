import { describe, expect, test } from "bun:test";

import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { createPlayerTelemetryState } from "@/infra/player/mpv-telemetry";
import { PersistentReadyWorkExecutor } from "@/infra/player/persistent-ready-work-executor";
import { PersistentSubtitleManager } from "@/infra/player/persistent-subtitle-manager";

function createFakeIpc(): { ipc: MpvIpcSession; commands: readonly unknown[][] } {
  const commands: unknown[][] = [];
  const ipc: MpvIpcSession = {
    async send(command) {
      commands.push([...command]);
      return {
        ok: true,
        command,
        requestId: commands.length,
        response: {},
      } satisfies MpvIpcCommandResult;
    },
    sendUnchecked(command) {
      commands.push([...command]);
    },
    async close() {},
  };
  return { ipc, commands };
}

function createCycle(events: unknown[]) {
  return {
    telemetry: createPlayerTelemetryState("/tmp/kunai-test.sock"),
    playerReadyNotified: false,
    onPlayerReady: () => events.push("ready-callback"),
    onPlaybackEvent: (event: unknown) => events.push(event),
  };
}

describe("PersistentReadyWorkExecutor", () => {
  test("skips redundant resume seek when loadfile already started at the same timestamp", async () => {
    const { ipc, commands } = createFakeIpc();
    const events: unknown[] = [];
    let currentPosition = 0;
    const resumePendingValues: boolean[] = [];

    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({ displayTitle: "Episode 1", primarySubtitle: null }),
      getLoadStartAt: () => 120,
      getTitleAppliedViaArgs: () => true,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => false,
      setSubtitlesAttachedAtSpawn: () => {},
      setCurrentPositionSeconds: (value) => {
        currentPosition = value;
      },
      setResumeSeekPending: (value) => resumePendingValues.push(value),
      waitResumeOrStartOverChoice: async () => "start",
      handleSegmentSkipProgress: async () => {},
      subtitleManager: new PersistentSubtitleManager(),
    });

    await executor.execute(
      {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        startAt: 120,
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
    );

    expect(commands.some((command) => command[0] === "seek")).toBe(false);
    expect(currentPosition).toBe(120);
    expect(resumePendingValues).toEqual([true, false]);
    expect(events).toContainEqual({ type: "resolving-playback" });
  });

  test("seeks after the user chooses resume from a start-over prompt", async () => {
    const { ipc, commands } = createFakeIpc();
    let currentPosition = 0;

    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({ displayTitle: "Episode 1", primarySubtitle: null }),
      getLoadStartAt: () => 0,
      getTitleAppliedViaArgs: () => false,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => false,
      setSubtitlesAttachedAtSpawn: () => {},
      setCurrentPositionSeconds: (value) => {
        currentPosition = value;
      },
      setResumeSeekPending: () => {},
      waitResumeOrStartOverChoice: async () => "resume",
      handleSegmentSkipProgress: async () => {},
      subtitleManager: new PersistentSubtitleManager(),
    });

    await executor.execute(
      {
        displayTitle: "Episode 2",
        primarySubtitle: null,
        startAt: 0,
        resumePromptAt: 90,
        offerResumeStartChoice: true,
      },
      createCycle([]),
    );

    expect(commands).toContainEqual(["seek", 90, "absolute"]);
    expect(currentPosition).toBe(90);
  });

  test("uses spawn-attached subtitle inventory without removing and re-adding the same primary subtitle", async () => {
    const { ipc, commands } = createFakeIpc();
    const events: unknown[] = [];
    let subtitlesAttachedAtSpawn = true;

    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({
        displayTitle: "Episode 1",
        primarySubtitle: "https://subs.example/main.vtt",
      }),
      getLoadStartAt: () => 0,
      getTitleAppliedViaArgs: () => true,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => subtitlesAttachedAtSpawn,
      setSubtitlesAttachedAtSpawn: (value) => {
        subtitlesAttachedAtSpawn = value;
      },
      setCurrentPositionSeconds: () => {},
      setResumeSeekPending: () => {},
      waitResumeOrStartOverChoice: async () => "start",
      handleSegmentSkipProgress: async () => {},
      subtitleManager: new PersistentSubtitleManager(),
    });

    await executor.execute(
      {
        displayTitle: "Episode 1",
        primarySubtitle: "https://subs.example/main.vtt",
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
    );

    expect(commands.some((command) => command[0] === "sub-remove")).toBe(false);
    expect(commands.some((command) => command[0] === "sub-add")).toBe(false);
    expect(events).toContainEqual({ type: "subtitle-inventory-ready", trackCount: 1 });
    expect(events).toContainEqual({ type: "subtitle-attached", trackCount: 1 });
    expect(subtitlesAttachedAtSpawn).toBe(false);
  });
});
