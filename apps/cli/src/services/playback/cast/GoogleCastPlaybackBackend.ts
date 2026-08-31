import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { GoogleCastPlaybackTarget, PlaybackTarget } from "@/domain/playback/playback-target";
import type { PlaybackResult } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import type { PlayerControlService } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";

import type { PlaybackBackend, PlaybackBackendRequest } from "../PlaybackBackend";
import { assessDirectCastCompatibility } from "./cast-compatibility";
import {
  connectGoogleCast,
  type GoogleCastSession,
  type GoogleCastMedia,
} from "./GoogleCastClient";
import { GoogleCastDiscoveryService } from "./GoogleCastDiscoveryService";

const CAST_EVENT_GENERATION: PlaybackGeneration = { process: 0, cycle: 0 };

export class CastGatewayRequiredError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`Cast stream requires the local media gateway: ${reasons.join(", ")}`);
    this.name = "CastGatewayRequiredError";
  }
}

type CastBackendRuntime = {
  readonly connect: typeof connectGoogleCast;
  readonly discovery: Pick<GoogleCastDiscoveryService, "browse">;
};

export class GoogleCastPlaybackBackend implements PlaybackBackend {
  readonly kind = "google-cast" as const;
  private activeSession: GoogleCastSession | null = null;

  constructor(
    private readonly runtime: CastBackendRuntime = {
      connect: connectGoogleCast,
      discovery: new GoogleCastDiscoveryService(),
    },
    private readonly playerControl?: Pick<PlayerControlService, "getActive" | "setActive">,
  ) {}

  private async resolveTarget(
    target: GoogleCastPlaybackTarget,
    signal?: AbortSignal,
  ): Promise<GoogleCastPlaybackTarget> {
    if (target.host) return target;
    const discoverySignal = withTimeoutSignal(signal, 5_000);
    const normalizedName = target.name.trim().toLocaleLowerCase();
    let browser: ReturnType<GoogleCastDiscoveryService["browse"]> | null = null;
    return new Promise<GoogleCastPlaybackTarget>((resolve, reject) => {
      let settled = false;
      const finish = (result: GoogleCastPlaybackTarget | Error) => {
        if (settled) return;
        settled = true;
        discoverySignal.removeEventListener("abort", onAbort);
        browser?.stop();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const onAbort = () => finish(new Error(`Cast device not found: ${target.name}`));
      discoverySignal.addEventListener("abort", onAbort, { once: true });
      browser = this.runtime.discovery.browse((targets) => {
        const match = targets.find(
          (candidate) => candidate.name.trim().toLocaleLowerCase() === normalizedName,
        );
        if (match) finish(match);
      });
      const existing = browser.targets.find(
        (candidate) => candidate.name.trim().toLocaleLowerCase() === normalizedName,
      );
      if (existing) finish(existing);
      else if (discoverySignal.aborted) onAbort();
    });
  }

  async play(
    request: PlaybackBackendRequest,
    selectedTarget: PlaybackTarget,
  ): Promise<PlaybackResult> {
    if (selectedTarget.kind !== "google-cast") {
      throw new Error(`Google Cast backend cannot play target kind: ${selectedTarget.kind}`);
    }
    const compatibility = assessDirectCastCompatibility(request.stream);
    if (compatibility.kind === "gateway-required") {
      throw new CastGatewayRequiredError(compatibility.reasons);
    }
    if (compatibility.kind === "unsupported") {
      throw new Error(
        `Stream is not supported by Google Cast: ${compatibility.reasons.join(", ")}`,
      );
    }

    const target = await this.resolveTarget(selectedTarget, request.options.abortSignal);
    if (!target.host) throw new Error(`Cast device has no reachable address: ${target.name}`);
    const emit = (event: PlayerPlaybackEvent) =>
      request.options.onPlaybackEvent?.({ generation: CAST_EVENT_GENERATION, event });
    emit({ type: "launching-player" });

    let lastPosition = request.options.startAt ?? 0;
    let duration = 0;
    let started = false;
    let paused = false;
    let settled = false;
    let pendingResult: PlaybackResult | null = null;
    let settleResult: ((result: PlaybackResult) => void) | null = null;
    const finish = (endReason: PlaybackResult["endReason"]) => {
      if (settled) return;
      settled = true;
      const result: PlaybackResult = {
        watchedSeconds: Math.max(0, lastPosition - (request.options.startAt ?? 0)),
        duration,
        endReason,
        resultSource: "ipc",
        playerExitedCleanly: endReason !== "error",
        playerExitCode: null,
        playerExitSignal: null,
        lastNonZeroPositionSeconds: lastPosition || undefined,
        lastNonZeroDurationSeconds: duration || undefined,
        lastReliableProgressSeconds: lastPosition || undefined,
      };
      if (settleResult) settleResult(result);
      else pendingResult = result;
    };

    const session = await this.runtime.connect(
      { host: target.host, port: target.port ?? 8009 },
      {
        onStatus: (status) => {
          if (typeof status.currentTime === "number") lastPosition = status.currentTime;
          if (typeof status.media?.duration === "number") duration = status.media.duration;
          if (status.playerState === "PLAYING") {
            if (!started) {
              started = true;
              emit({ type: "playback-started" });
            } else if (paused) {
              emit({ type: "playback-resumed" });
            }
            paused = false;
            emit({
              type: "playback-progress",
              positionSeconds: lastPosition,
              durationSeconds: duration,
            });
          } else if (status.playerState === "PAUSED") {
            if (!paused) emit({ type: "playback-paused" });
            paused = true;
          } else if (status.playerState === "BUFFERING") {
            emit({ type: "network-buffering" });
          } else if (status.playerState === "IDLE") {
            finish(
              status.idleReason === "FINISHED"
                ? "eof"
                : status.idleReason === "ERROR"
                  ? "error"
                  : "quit",
            );
          }
        },
        onError: () => finish("error"),
        onClose: () => finish(started ? "quit" : "error"),
      },
      withTimeoutSignal(request.options.abortSignal, 8_000),
    );
    this.activeSession = session;
    const controlId = `google-cast:${target.id}`;
    this.playerControl?.setActive({
      id: controlId,
      stop: () => this.stop(),
    });
    emit({ type: "opening-stream" });
    const media: GoogleCastMedia = {
      contentId: request.stream.url,
      contentType: compatibility.contentType,
      streamType: request.stream.isLive ? "LIVE" : "BUFFERED",
      metadata: { metadataType: 0, title: request.options.displayTitle },
    };
    const initialStatus = await session.load(media, request.options.startAt ?? 0);
    request.options.onPlayerReady?.();
    emit({ type: "player-ready" });

    if (initialStatus.playerState === "PLAYING") {
      started = true;
      emit({ type: "playback-started" });
    }

    const abort = () => {
      void session.stop().finally(() => finish("quit"));
    };
    request.options.abortSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await new Promise<PlaybackResult>((resolve) => {
        settleResult = resolve;
        if (pendingResult) resolve(pendingResult);
      });
    } finally {
      request.options.abortSignal?.removeEventListener("abort", abort);
      if (this.activeSession === session) this.activeSession = null;
      if (this.playerControl?.getActive()?.id === controlId) this.playerControl.setActive(null);
      session.close();
    }
  }

  pause(): Promise<unknown> {
    return this.activeSession?.pause() ?? Promise.resolve();
  }

  resume(): Promise<unknown> {
    return this.activeSession?.play() ?? Promise.resolve();
  }

  seek(seconds: number): Promise<unknown> {
    return this.activeSession?.seek(seconds) ?? Promise.resolve();
  }

  async stop(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    await session.stop();
    session.close();
    if (this.activeSession === session) this.activeSession = null;
  }
}
