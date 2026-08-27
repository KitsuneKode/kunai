import { describe, expect, test } from "bun:test";

import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { createPlayerStatsState } from "@/infra/player/mpv-stats";
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
    stats: createPlayerStatsState("/tmp/kunai-test.sock"),
    playerReadyNotified: false,
    onPlayerReady: () => events.push("ready-callback"),
    onPlaybackEvent: (event: unknown) => events.push(event),
  };
}

const GENERATION: PlaybackGeneration = { process: 3, cycle: 8 };

describe("PersistentReadyWorkExecutor", () => {
  test("a live stream never prompts to resume and never seeks", async () => {
    // The caller already drops startAt/resumePromptAt for a live broadcast, but that
    // left one call site as the only thing preventing an absolute seek — the same
    // single-point fragility that let the in-process reconnect seek survive the first
    // fix. Even handed a full resume request, the executor must refuse.
    const { ipc, commands } = createFakeIpc();
    const events: unknown[] = [];
    const resumePendingValues: boolean[] = [];
    let promptShown = false;

    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({ displayTitle: "Live broadcast", primarySubtitle: null }),
      getLoadStartAt: () => null,
      getTitleAppliedViaArgs: () => true,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => false,
      setSubtitlesAttachedAtSpawn: () => {},
      setCurrentPositionSeconds: () => {},
      setResumeSeekPending: (value) => resumePendingValues.push(value),
      waitResumeOrStartOverChoice: async () => {
        promptShown = true;
        return "resume";
      },
      handleSegmentSkipProgress: async () => {},
      subtitleManager: new PersistentSubtitleManager(),
      isLiveStream: () => true,
      isGenerationCurrent: () => true,
    });

    await executor.execute(
      {
        displayTitle: "Live broadcast",
        primarySubtitle: null,
        startAt: 3_600,
        resumePromptAt: 3_600,
        offerResumeStartChoice: true,
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
      GENERATION,
    );

    expect(promptShown).toBe(false);
    expect(commands.some((command) => command[0] === "seek")).toBe(false);
    // Never armed, so segment-skip work is not held back waiting for a seek.
    expect(resumePendingValues.every((value) => value === false)).toBe(true);
  });

  test("a recorded stream with the same options still resumes", async () => {
    // The guard has to key on live-ness alone; otherwise it would silently disable
    // resume for ordinary playback.
    const { ipc, commands } = createFakeIpc();
    const events: unknown[] = [];
    let promptShown = false;

    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({ displayTitle: "Episode 1", primarySubtitle: null }),
      getLoadStartAt: () => null,
      getTitleAppliedViaArgs: () => true,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => false,
      setSubtitlesAttachedAtSpawn: () => {},
      setCurrentPositionSeconds: () => {},
      setResumeSeekPending: () => {},
      waitResumeOrStartOverChoice: async () => {
        promptShown = true;
        return "resume";
      },
      handleSegmentSkipProgress: async () => {},
      subtitleManager: new PersistentSubtitleManager(),
      isLiveStream: () => false,
      isGenerationCurrent: () => true,
    });

    await executor.execute(
      {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        startAt: 3_600,
        resumePromptAt: 3_600,
        offerResumeStartChoice: true,
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
      GENERATION,
    );

    expect(promptShown).toBe(true);
    expect(commands).toContainEqual(["seek", 3_600, "absolute"]);
  });

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
      isLiveStream: () => false,
      isGenerationCurrent: () => true,
    });

    await executor.execute(
      {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        startAt: 120,
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
      GENERATION,
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
      isLiveStream: () => false,
      isGenerationCurrent: () => true,
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
      GENERATION,
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
      isLiveStream: () => false,
      isGenerationCurrent: () => true,
    });

    await executor.execute(
      {
        displayTitle: "Episode 1",
        primarySubtitle: "https://subs.example/main.vtt",
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
      GENERATION,
    );

    expect(commands.some((command) => command[0] === "sub-remove")).toBe(false);
    expect(commands.some((command) => command[0] === "sub-add")).toBe(false);
    expect(events).toContainEqual({ type: "subtitle-inventory-ready", trackCount: 1 });
    expect(events).toContainEqual({ type: "subtitle-attached", trackCount: 1 });
    expect(subtitlesAttachedAtSpawn).toBe(false);
  });
});

describe("PersistentReadyWorkExecutor stale-generation continuations", () => {
  /**
   * Holds one await boundary open, retires the generation while it is pending,
   * then resolves it. Nothing after that boundary may run.
   */
  async function runWithRetirementAt(boundary: {
    readonly gate: "unpause" | "title" | "resume-choice" | "seek" | "subtitles";
  }): Promise<{ commands: readonly unknown[][]; events: unknown[]; skipRuns: number }> {
    const commands: unknown[][] = [];
    const events: unknown[] = [];
    let current = true;
    let skipRuns = 0;
    let released = false;

    const gateOn = (name: typeof boundary.gate) => async () => {
      if (released || name !== boundary.gate) return;
      released = true;
      // The replacement takes over while this boundary is still pending.
      current = false;
    };

    const ipc: MpvIpcSession = {
      async send(command) {
        commands.push([...command]);
        const key = String(command[0]);
        if (key === "set_property" && command[1] === "pause") await gateOn("unpause")();
        if (key === "set_property" && command[1] === "force-media-title") await gateOn("title")();
        if (key === "seek") await gateOn("seek")();
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

    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({ displayTitle: "Other", primarySubtitle: null }),
      getLoadStartAt: () => null,
      getTitleAppliedViaArgs: () => false,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => false,
      setSubtitlesAttachedAtSpawn: () => {},
      setCurrentPositionSeconds: () => {},
      setResumeSeekPending: () => {},
      waitResumeOrStartOverChoice: async () => {
        await gateOn("resume-choice")();
        return "resume";
      },
      handleSegmentSkipProgress: async () => {
        skipRuns += 1;
      },
      subtitleManager: new PersistentSubtitleManager(),
      isLiveStream: () => false,
      isGenerationCurrent: () => current,
    });

    await executor.execute(
      {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        resumePromptAt: 90,
        offerResumeStartChoice: true,
        onPlaybackEvent: (event) => events.push(event),
      },
      createCycle(events),
      GENERATION,
    );

    return { commands, events, skipRuns };
  }

  test("a retirement during the unpause command stops every later command", async () => {
    const { commands, skipRuns } = await runWithRetirementAt({ gate: "unpause" });
    expect(commands.map((command) => command[0])).toEqual(["set_property"]);
    expect(skipRuns).toBe(0);
  });

  test("a retirement during the title update stops the resume prompt and seek", async () => {
    const { commands, skipRuns } = await runWithRetirementAt({ gate: "title" });
    expect(commands.some((command) => command[0] === "seek")).toBe(false);
    expect(skipRuns).toBe(0);
  });

  test("a retirement during the resume-choice wait stops the seek", async () => {
    const { commands, skipRuns } = await runWithRetirementAt({ gate: "resume-choice" });
    expect(commands.some((command) => command[0] === "seek")).toBe(false);
    expect(skipRuns).toBe(0);
  });

  test("a retirement during the seek stops subtitle replacement and segment-skip setup", async () => {
    const { skipRuns } = await runWithRetirementAt({ gate: "seek" });
    expect(skipRuns).toBe(0);
  });

  test("a stale execute does nothing at all, not even the ready notification", async () => {
    const { ipc, commands } = createFakeIpc();
    const events: unknown[] = [];
    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => ipc,
      getInitialOptions: () => ({ displayTitle: "Episode 1", primarySubtitle: null }),
      getLoadStartAt: () => null,
      getTitleAppliedViaArgs: () => true,
      setTitleAppliedViaArgs: () => {},
      getSubtitlesAttachedAtSpawn: () => false,
      setSubtitlesAttachedAtSpawn: () => {},
      setCurrentPositionSeconds: () => {},
      setResumeSeekPending: () => {},
      waitResumeOrStartOverChoice: async () => "start",
      handleSegmentSkipProgress: async () => {},
      subtitleManager: new PersistentSubtitleManager(),
      isLiveStream: () => false,
      isGenerationCurrent: () => false,
    });

    await executor.execute(
      { displayTitle: "Episode 1", primarySubtitle: null, onPlaybackEvent: (e) => events.push(e) },
      createCycle(events),
      GENERATION,
    );

    expect(commands).toEqual([]);
    expect(events).toEqual([]);
  });
});
