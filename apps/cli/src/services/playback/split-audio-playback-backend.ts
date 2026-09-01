import type { SplitAudioPlaybackTarget, PlaybackTarget } from "@/domain/playback/playback-target";
import type {
  ActivePlayerControl,
  PlayerControlService,
} from "@/infra/player/PlayerControlService";
import type { PlayerService } from "@/infra/player/PlayerService";

import {
  AudioExtractionGateway,
  type AudioExtractionGatewayFactory,
  type AudioExtractionGatewayHandle,
} from "./cast/audio-extraction-gateway";
import { GoogleCastPlaybackBackend } from "./cast/google-cast-playback-backend";
import type { PlaybackBackend, PlaybackBackendRequest } from "./playback-backend";

const SYNC_INTERVAL_MS = 1_000;
const DRIFT_TOLERANCE_SECONDS = 0.2;
const REMOTE_START_TIMEOUT_MS = 20_000;

export function splitRemoteSourcePosition(sourceStartAt: number, remotePosition: number): number {
  return Math.max(0, sourceStartAt + remotePosition);
}

export function isAdvancingRemoteClock(previous: number | null, current: number): boolean {
  return previous !== null && current > previous + 0.1;
}

/** Experimental local-video / Google-Cast-audio coordinator. */
export class SplitAudioPlaybackBackend implements PlaybackBackend {
  readonly kind = "split-audio" as const;
  private abortCast: AbortController | null = null;
  private activeAudioGateway: AudioExtractionGatewayHandle | null = null;

  constructor(
    private readonly player: PlayerService,
    private readonly playerControl: PlayerControlService,
    private readonly cast: Pick<
      GoogleCastPlaybackBackend,
      "play" | "stop" | "getPosition" | "togglePause" | "seek"
    > = new GoogleCastPlaybackBackend(undefined, undefined, false),
    private readonly audioGateway: AudioExtractionGatewayFactory = new AudioExtractionGateway(),
  ) {}

  async play(request: PlaybackBackendRequest, target: PlaybackTarget) {
    if (target.kind !== "split-audio") throw new Error("Split audio requires a split target");
    if (!target.audioTarget.host) {
      throw new Error("Split Cast audio requires a discovered receiver address");
    }
    request.options.onPlaybackEvent?.({
      generation: { process: 0, cycle: 0 },
      event: { type: "network-buffering" },
    });
    const audioGateway = await this.audioGateway.start({
      stream: request.stream,
      receiverHost: target.audioTarget.host,
      startAt: request.options.startAt,
    });
    this.activeAudioGateway = audioGateway;
    const sourceStartAt = request.options.startAt ?? 0;
    let localPlayback: ReturnType<PlayerService["play"]>;
    let localControl: ActivePlayerControl;
    try {
      let markLocalReady!: () => void;
      const localReady = new Promise<void>((resolve) => {
        markLocalReady = resolve;
      });
      localPlayback = this.player.play(request.stream, {
        ...request.options,
        startAt: sourceStartAt,
        videoOnly: true,
        onPlayerReady: () => {
          request.options.onPlayerReady?.();
          markLocalReady();
        },
      });
      await Promise.race([
        localReady,
        localPlayback.then(() => {
          throw new Error("Local video ended before it became ready");
        }),
      ]);
      const preparedControl = await this.playerControl.waitForActivePlayer({ timeoutMs: 8_000 });
      if (!preparedControl?.togglePause) {
        throw new Error("Local video could not be paused for split-output synchronization");
      }
      await preparedControl.togglePause();
      localControl = preparedControl;
    } catch (error) {
      await audioGateway.close();
      if (this.activeAudioGateway === audioGateway) this.activeAudioGateway = null;
      throw error;
    }
    const audioStream = {
      ...request.stream,
      url: audioGateway.mediaUrl,
      headers: {},
      subtitle: undefined,
      subtitleList: undefined,
      isLive: true,
      title: `${request.options.displayTitle} · Audio`,
      timestamp: Date.now(),
    };
    const castAbort = new AbortController();
    this.abortCast = castAbort;
    let remoteStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      remoteStarted = resolve;
    });
    const castPlayback = this.cast.play(
      {
        stream: audioStream,
        options: {
          ...request.options,
          startAt: 0,
          abortSignal: castAbort.signal,
          onGenerationActivated: undefined,
          onPlaybackEvent: ({ event }) => {
            if (event.type === "playback-started") remoteStarted();
          },
        },
      },
      target.audioTarget,
    );
    let localPlaybackFinished = false;

    try {
      let startTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          started,
          castPlayback.then(() => {
            throw new Error("Remote audio ended before playback started");
          }),
          localPlayback.then(() => {
            throw new Error("Local video ended before remote audio started");
          }),
          new Promise<never>((_resolve, reject) => {
            startTimer = setTimeout(
              () => reject(new Error("Audio receiver did not start playback")),
              REMOTE_START_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (startTimer) clearTimeout(startTimer);
      }
      const remotePosition = splitRemoteSourcePosition(sourceStartAt, this.cast.getPosition() ?? 0);
      await localControl.seekAbsolute?.(remotePosition);
      await localControl.togglePause?.();
      const composite = this.compositeControl(localControl);
      this.playerControl.setActive(composite);
      let previousRemotePosition: number | null = this.cast.getPosition();
      const sync = setInterval(() => {
        const local = localControl.getStatsSnapshot?.()?.positionSeconds;
        const remote = this.cast.getPosition();
        const remoteClockAdvanced =
          remote !== null && isAdvancingRemoteClock(previousRemotePosition, remote);
        previousRemotePosition = remote;
        if (
          local === undefined ||
          remote === null ||
          !remoteClockAdvanced ||
          Math.abs(splitRemoteSourcePosition(sourceStartAt, remote) - local) <
            DRIFT_TOLERANCE_SECONDS
        )
          return;
        void localControl.seekAbsolute?.(splitRemoteSourcePosition(sourceStartAt, remote));
      }, SYNC_INTERVAL_MS);
      try {
        const result = await localPlayback;
        localPlaybackFinished = true;
        return result;
      } finally {
        clearInterval(sync);
      }
    } finally {
      castAbort.abort();
      await this.cast.stop();
      await castPlayback.catch(() => undefined);
      if (!localPlaybackFinished) await localControl.stop("split audio stopped");
      await audioGateway.close();
      if (this.activeAudioGateway === audioGateway) this.activeAudioGateway = null;
      if (this.abortCast === castAbort) this.abortCast = null;
    }
  }

  async stop(): Promise<void> {
    this.abortCast?.abort();
    await Promise.all([this.cast.stop(), this.activeAudioGateway?.close()]);
    this.activeAudioGateway = null;
  }

  private compositeControl(local: ActivePlayerControl): ActivePlayerControl {
    return {
      ...local,
      id: `split-audio:${local.id}`,
      stop: async (reason) => {
        await Promise.all([local.stop(reason), this.cast.stop()]);
      },
      togglePause: async () => {
        await Promise.all([local.togglePause?.(), this.cast.togglePause()]);
      },
      seekRelative: async (seconds) => {
        const localPosition = local.getStatsSnapshot?.()?.positionSeconds ?? 0;
        const target = Math.max(0, localPosition + seconds);
        await Promise.all([local.seekAbsolute?.(target), this.cast.seek(target)]);
      },
      seekAbsolute: async (seconds) => {
        await Promise.all([local.seekAbsolute?.(seconds), this.cast.seek(seconds)]);
      },
    };
  }
}

export function splitAudioTarget(
  audioTarget: SplitAudioPlaybackTarget["audioTarget"],
): SplitAudioPlaybackTarget {
  return {
    kind: "split-audio",
    id: `split-audio:${audioTarget.id}`,
    name: `This device + ${audioTarget.name}`,
    audioTarget,
    capabilities: ["audio", "video"],
  };
}
