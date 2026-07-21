import { describe, expect, mock, test } from "bun:test";

import { runMpvPlaybackSession } from "@/app/playback/run-mpv-playback-session";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerService,
} from "@/infra/player/PlayerService";

const TITLE: TitleInfo = { id: "1396", name: "Test", type: "series" };
const EPISODE: EpisodeInfo = { season: 1, episode: 1 };
const STREAM: StreamInfo = {
  url: "https://example.test/stream.m3u8",
  headers: {},
  timestamp: Date.now(),
};

const FINISHED: PlaybackResult = {
  endReason: "eof",
  watchedSeconds: 10,
  duration: 10,
  lastNonZeroPositionSeconds: 10,
  lastNonZeroDurationSeconds: 10,
  playerExitCode: 0,
  playerExitSignal: null,
};

function noopHooks() {
  return {
    onFeedback: () => undefined,
    onPresenceLaunch: () => undefined,
    onPresenceStarted: () => undefined,
    onPresenceProgress: () => undefined,
    onPresenceSubtitles: () => undefined,
    onPresencePaused: () => undefined,
    onPresenceResumed: () => undefined,
    setPlaybackStatus: () => undefined,
    getPlaybackStatus: () => "idle",
    onTrackChanged: () => undefined,
    onShareCopied: () => undefined,
    onPlayerReady: () => undefined,
  };
}

async function runWithPlayerEvents(
  events: readonly PlayerPlaybackEvent[],
  options: { onConfirmedStart?: () => void } = {},
): Promise<PlaybackResult> {
  const player: PlayerService = {
    play: async (_stream, playOptions: PlayerOptions) => {
      for (const event of events) {
        playOptions.onPlaybackEvent?.(event);
      }
      return FINISHED;
    },
    releasePersistentSession: async () => undefined,
    killActiveMpvProcessesSync: () => undefined,
    beginShutdown: () => undefined,
    isAvailable: async () => true,
    playLocal: async () => FINISHED,
  };

  return runMpvPlaybackSession({
    stream: STREAM,
    title: TITLE,
    episode: EPISODE,
    player,
    playOptions: {},
    subtitleStatus: "none",
    startAt: 0,
    sessionAborted: false,
    iterationAborted: false,
    shareLinkContext: {
      mode: "series",
      title: TITLE,
      episode: { season: 1, episode: 1 },
    },
    timing: null,
    hooks: {
      ...noopHooks(),
      onConfirmedPlaybackStart: options.onConfirmedStart,
    },
  });
}

describe("runMpvPlaybackSession queue acknowledgement boundary", () => {
  test("mpv process start does not acknowledge", async () => {
    const onConfirmedStart = mock();
    await runWithPlayerEvents([{ type: "mpv-process-started" }], { onConfirmedStart });
    expect(onConfirmedStart).not.toHaveBeenCalled();
  });

  test("ipc-connected does not acknowledge", async () => {
    const onConfirmedStart = mock();
    await runWithPlayerEvents([{ type: "ipc-connected" }], { onConfirmedStart });
    expect(onConfirmedStart).not.toHaveBeenCalled();
  });

  test("playback-started acknowledges once", async () => {
    const onConfirmedStart = mock();
    await runWithPlayerEvents([{ type: "playback-started" }, { type: "playback-started" }], {
      onConfirmedStart,
    });
    expect(onConfirmedStart).toHaveBeenCalledTimes(1);
  });
});
