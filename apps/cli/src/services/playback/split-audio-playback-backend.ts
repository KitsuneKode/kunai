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

const REMOTE_START_TIMEOUT_MS = 20_000;
const DRIFT_TOLERANCE_SECONDS = 0.25;

export function splitAudioVideoCorrection(
  localPosition: number | undefined,
  remoteSourcePosition: number,
): number | null {
  if (localPosition === undefined) return null;
  return Math.abs(remoteSourcePosition - localPosition) >= DRIFT_TOLERANCE_SECONDS
    ? Math.max(0, remoteSourcePosition)
    : null;
}

type RemoteAudioState = {
  readonly abort: AbortController;
  readonly gateway: AudioExtractionGatewayHandle;
  readonly playback: Promise<unknown>;
};

/** Experimental local-video / Google-Cast-audio coordinator. Local mpv owns time. */
export class SplitAudioPlaybackBackend implements PlaybackBackend {
  readonly kind = "split-audio" as const;
  private activeRemoteStop: (() => Promise<void>) | null = null;
  private activeLocalStop: ((reason?: string) => Promise<void>) | null = null;

  constructor(
    private readonly player: PlayerService,
    private readonly playerControl: PlayerControlService,
    private readonly cast: Pick<
      GoogleCastPlaybackBackend,
      "play" | "getPosition"
    > = new GoogleCastPlaybackBackend(undefined, undefined, false),
    private readonly audioGateway: AudioExtractionGatewayFactory = new AudioExtractionGateway(),
  ) {}

  async play(request: PlaybackBackendRequest, target: PlaybackTarget) {
    if (target.kind !== "split-audio") throw new Error("Split audio requires a split target");
    if (!target.audioTarget.host) {
      throw new Error("Split Cast audio requires a discovered receiver address");
    }
    const receiverHost = target.audioTarget.host;
    request.options.onPlaybackEvent?.({
      generation: { process: 0, cycle: 0 },
      event: { type: "network-buffering" },
    });

    let markLocalReady!: () => void;
    const localReady = new Promise<void>((resolve) => {
      markLocalReady = resolve;
    });
    const sourceStartAt = request.options.startAt ?? 0;
    const localPlayback = this.player.play(request.stream, {
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
    const localControl = await this.playerControl.waitForActivePlayer({ timeoutMs: 8_000 });
    if (!localControl?.setPaused || !localControl.seekAbsolute) {
      await localControl?.stop("split audio controls unavailable");
      throw new Error("Local video does not expose the controls required for split output");
    }
    await localControl.setPaused(true);
    const stopLocal = (reason?: string) => localControl.stop(reason);
    this.activeLocalStop = stopLocal;

    let remote: RemoteAudioState | null = null;
    let stopping = false;
    const pauseState = { paused: true };
    let syncQueue: Promise<void> = Promise.resolve();
    const alignVideoToRemote = (remoteSourcePosition: number) => {
      if (stopping || pauseState.paused) return;
      const correction = splitAudioVideoCorrection(
        localControl.getStatsSnapshot?.()?.positionSeconds,
        remoteSourcePosition,
      );
      if (correction === null) return;
      syncQueue = syncQueue
        .catch(() => undefined)
        .then(async () => {
          if (!stopping && !pauseState.paused) await localControl.seekAbsolute?.(correction);
          return undefined;
        });
    };
    const stopRemote = async () => {
      const current = remote;
      if (!current) return;
      remote = null;
      current.abort.abort("split audio restart");
      await current.gateway.close();
      await current.playback.catch(() => undefined);
    };
    this.activeRemoteStop = stopRemote;

    const startRemoteAt = async (position: number) => {
      await stopRemote();
      if (stopping) return 0;
      const gateway = await this.audioGateway.start({
        stream: request.stream,
        receiverHost,
        startAt: Math.max(0, position),
      });
      const abort = new AbortController();
      const sourcePosition = Math.max(0, position);
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const playback = this.cast.play(
        {
          stream: {
            ...request.stream,
            url: gateway.mediaUrl,
            headers: {},
            subtitle: undefined,
            subtitleList: undefined,
            isLive: true,
            title: `${request.options.displayTitle} · Audio`,
            timestamp: Date.now(),
          },
          options: {
            ...request.options,
            startAt: 0,
            abortSignal: abort.signal,
            onGenerationActivated: undefined,
            onPlaybackEvent: ({ event }) => {
              if (event.type === "playback-started") markStarted();
              if (event.type === "playback-progress" && remote?.abort === abort) {
                alignVideoToRemote(sourcePosition + event.positionSeconds);
              }
            },
          },
        },
        target.audioTarget,
      );
      remote = { abort, gateway, playback };
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          started,
          playback.then(() => {
            throw new Error("Remote audio ended before playback started");
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Audio receiver did not start playback")),
              REMOTE_START_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (error) {
        await stopRemote();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
      return Math.max(0, this.cast.getPosition() ?? 0);
    };

    let restartQueue: Promise<number> = Promise.resolve(0);
    const restartRemoteAt = (position: number) => {
      restartQueue = restartQueue.catch(() => 0).then(() => startRemoteAt(position));
      return restartQueue;
    };
    let localPlaybackFinished = false;
    try {
      const remoteElapsed = await restartRemoteAt(sourceStartAt);
      if (remoteElapsed > 0) await localControl.seekAbsolute(sourceStartAt + remoteElapsed);
      await localControl.setPaused(false);
      pauseState.paused = false;
      this.playerControl.setActive(
        this.compositeControl(localControl, pauseState, restartRemoteAt, stopRemote),
      );
      const result = await localPlayback;
      localPlaybackFinished = true;
      return result;
    } finally {
      stopping = true;
      await restartQueue.catch(() => undefined);
      await syncQueue.catch(() => undefined);
      await stopRemote();
      if (!localPlaybackFinished) await localControl.stop("split audio stopped");
      if (this.activeRemoteStop === stopRemote) this.activeRemoteStop = null;
      if (this.activeLocalStop === stopLocal) this.activeLocalStop = null;
    }
  }

  async stop(): Promise<void> {
    const stopLocal = this.activeLocalStop;
    const stopRemote = this.activeRemoteStop;
    this.activeLocalStop = null;
    this.activeRemoteStop = null;
    await Promise.all([stopLocal?.("split audio stopped"), stopRemote?.()]);
  }

  private compositeControl(
    local: ActivePlayerControl,
    pauseState: { paused: boolean },
    restartRemoteAt: (position: number) => Promise<number>,
    stopRemote: () => Promise<void>,
  ): ActivePlayerControl {
    let controlQueue: Promise<void> = Promise.resolve();
    const serialize = (operation: () => Promise<void>) => {
      const result = controlQueue.then(operation, operation);
      controlQueue = result.catch(() => undefined);
      return result;
    };
    const seek = (position: number) =>
      serialize(async () => {
        const wasPaused = pauseState.paused;
        await local.setPaused?.(true);
        pauseState.paused = true;
        await local.seekAbsolute?.(position);
        if (wasPaused) return;
        const remoteElapsed = await restartRemoteAt(position);
        if (remoteElapsed > 0) await local.seekAbsolute?.(position + remoteElapsed);
        await local.setPaused?.(false);
        pauseState.paused = false;
      });
    const setSplitPaused = (paused: boolean) =>
      serialize(async () => {
        if (paused === pauseState.paused) return;
        if (paused) {
          await local.setPaused?.(true);
          pauseState.paused = true;
          await stopRemote();
          return;
        }
        const position = local.getStatsSnapshot?.()?.positionSeconds ?? 0;
        const remoteElapsed = await restartRemoteAt(position);
        if (remoteElapsed > 0) await local.seekAbsolute?.(position + remoteElapsed);
        await local.setPaused?.(false);
        pauseState.paused = false;
      });
    return {
      ...local,
      id: `split-audio:${local.id}`,
      stop: async (reason) => {
        await Promise.all([local.stop(reason), this.activeRemoteStop?.()]);
      },
      togglePause: async () => await setSplitPaused(!pauseState.paused),
      setPaused: setSplitPaused,
      seekRelative: async (seconds) => {
        const localPosition = local.getStatsSnapshot?.()?.positionSeconds ?? 0;
        await seek(Math.max(0, localPosition + seconds));
      },
      seekAbsolute: async (seconds) => await seek(Math.max(0, seconds)),
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
