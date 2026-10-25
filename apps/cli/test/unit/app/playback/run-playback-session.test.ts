import { describe, expect, test } from "bun:test";

import type { MpvPlaybackSessionHooks } from "@/app/playback/run-mpv-playback-session";
import { runPlaybackSession } from "@/app/playback/run-playback-session";
import {
  DETACHED_HANDOFF_CAPABILITIES,
  MANAGED_MPV_CAPABILITIES,
} from "@/domain/playback/player-capabilities";
import type { PlaybackResult } from "@/domain/types";
import type { PlayerOptions, PlayerService } from "@/infra/player/PlayerService";

const FINISHED: PlaybackResult = { watchedSeconds: 10, duration: 10, endReason: "eof" };
const HANDOFF: PlaybackResult = {
  watchedSeconds: 0,
  duration: 0,
  endReason: "unknown",
  resultSource: "handoff",
  handoff: { accepted: true, player: "vlc", launcher: "termux-am" },
};

function player(playerInput: {
  readonly detached: boolean;
  readonly result: PlaybackResult;
  readonly onPlay?: (options: PlayerOptions) => void;
}): PlayerService {
  return {
    capabilities: playerInput.detached ? DETACHED_HANDOFF_CAPABILITIES : MANAGED_MPV_CAPABILITIES,
    play: async (_stream, options) => {
      playerInput.onPlay?.(options);
      if (!playerInput.detached) options.onGenerationActivated?.({ process: 1, cycle: 1 });
      return playerInput.result;
    },
    releasePersistentSession: async () => undefined,
    killActiveMpvProcessesSync: () => undefined,
    beginShutdown: () => undefined,
    isAvailable: async () => true,
    playLocal: async () => playerInput.result,
  };
}

function hooks(calls: string[]): MpvPlaybackSessionHooks {
  return {
    onFeedback: (feedback) => calls.push(`feedback:${feedback.detail ?? ""}`),
    onStartupMark: () => calls.push("startup"),
    onStartupStallAbort: () => {
      calls.push("stall");
    },
    onConfirmedPlaybackStart: () => calls.push("confirmed"),
    onPresenceLaunch: () => calls.push("presence-launch"),
    onPresenceStarted: () => calls.push("presence-started"),
    onPresenceProgress: () => calls.push("presence-progress"),
    onPresenceSubtitles: () => calls.push("presence-subtitles"),
    onPresencePaused: () => calls.push("presence-paused"),
    onPresenceResumed: () => calls.push("presence-resumed"),
    applyPlaybackStatusSignal: (signal) => ({
      accepted: true,
      statusChanged: false,
      clearFeedback: false,
      snapshot: {
        status: signal.kind === "activate" ? signal.status : "idle",
        generation: "generation" in signal ? signal.generation : { process: 0, cycle: 0 },
      },
    }),
    onTrackChanged: () => calls.push("track"),
    onShareCopied: () => calls.push("share"),
    onPlayerReady: () => calls.push("ready"),
  };
}

function input(service: PlayerService, calls: string[]) {
  return {
    stream: { url: "https://media.example/episode.m3u8", headers: {}, timestamp: 1 },
    title: { id: "1", name: "Example", type: "series" as const },
    episode: { season: 1, episode: 2 },
    player: service,
    playOptions: { onNearEof: () => calls.push("near-eof") },
    subtitleStatus: "none",
    startAt: 0,
    hooks: hooks(calls),
    sessionAborted: false,
    iterationAborted: false,
    shareLinkContext: {
      mode: "series" as const,
      title: { id: "1", name: "Example", type: "series" as const },
      episode: { season: 1, episode: 2 },
    },
    timing: null,
  };
}

describe("runPlaybackSession", () => {
  test("preserves the observed mpv runner for managed players", async () => {
    const calls: string[] = [];
    let options: PlayerOptions | undefined;
    const result = await runPlaybackSession(
      input(
        player({ detached: false, result: FINISHED, onPlay: (value) => (options = value) }),
        calls,
      ),
    );

    expect(result).toBe(FINISHED);
    expect(calls).toContain("presence-launch");
    expect(options?.onPlaybackEvent).toBeFunction();
    expect(options?.onGenerationActivated).toBeFunction();
  });

  test("hands off without wiring managed-player observation hooks", async () => {
    const calls: string[] = [];
    let options: PlayerOptions | undefined;
    const result = await runPlaybackSession(
      input(
        player({ detached: true, result: HANDOFF, onPlay: (value) => (options = value) }),
        calls,
      ),
    );

    expect(result).toBe(HANDOFF);
    expect(options).toMatchObject({
      url: "https://media.example/episode.m3u8",
      displayTitle: "Example - S01E02",
    });
    expect(options?.onPlaybackEvent).toBeUndefined();
    expect(options?.onGenerationActivated).toBeUndefined();
    expect(options?.onNearEof).toBeUndefined();
    expect(calls.filter((call) => call.startsWith("presence"))).toEqual([]);
    expect(calls).toEqual(["feedback:Opened externally"]);
  });
});
