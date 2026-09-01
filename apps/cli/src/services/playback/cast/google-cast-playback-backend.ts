import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { GoogleCastPlaybackTarget, PlaybackTarget } from "@/domain/playback/playback-target";
import type { PlaybackResult } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import type { PlayerControlService } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";

import type { PlaybackBackend, PlaybackBackendRequest } from "../playback-backend";
import { assessDirectCastCompatibility } from "./cast-compatibility";
import {
  CastSubtitleGateway,
  type CastSubtitleGatewayFactory,
  type CastSubtitleGatewayHandle,
} from "./cast-subtitle-gateway";
import {
  connectGoogleCast,
  type GoogleCastSession,
  type GoogleCastMedia,
} from "./google-cast-client";
import { GoogleCastDiscoveryService } from "./google-cast-discovery-service";
import {
  SessionMediaGateway,
  type SessionMediaGatewayFactory,
  type SessionMediaGatewayHandle,
} from "./session-media-gateway";

const CAST_EVENT_GENERATION: PlaybackGeneration = { process: 0, cycle: 0 };

export function extrapolateCastPosition(
  position: number,
  observedAt: number,
  now: number,
  advancing: boolean,
): number {
  if (!advancing) return position;
  return position + Math.max(0, now - observedAt) / 1_000;
}

export class CastGatewayRequiredError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`Cast stream requires the local media gateway: ${reasons.join(", ")}`);
    this.name = "CastGatewayRequiredError";
  }
}

type CastBackendRuntime = {
  readonly connect: typeof connectGoogleCast;
  readonly discovery: Pick<GoogleCastDiscoveryService, "browse">;
  readonly gateway: SessionMediaGatewayFactory;
  readonly subtitles?: CastSubtitleGatewayFactory;
  readonly now?: () => number;
};

export class GoogleCastPlaybackBackend implements PlaybackBackend {
  readonly kind = "google-cast" as const;
  private activeSession: GoogleCastSession | null = null;
  private activeGateway: SessionMediaGatewayHandle | null = null;
  private activeSubtitleGateway: CastSubtitleGatewayHandle | null = null;
  private lastKnownPosition = 0;
  private lastKnownPositionObservedAt = 0;
  private positionAdvancing = false;
  private paused = false;

  constructor(
    private readonly runtime: CastBackendRuntime = {
      connect: connectGoogleCast,
      discovery: new GoogleCastDiscoveryService(),
      gateway: new SessionMediaGateway(),
      subtitles: new CastSubtitleGateway(),
    },
    private readonly playerControl?: Pick<PlayerControlService, "getActive" | "setActive">,
    private readonly registerPlayerControls = true,
    private readonly receiverAppId?: string,
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
    if (compatibility.kind === "unsupported") {
      throw new Error(
        `Stream is not supported by Google Cast: ${compatibility.reasons.join(", ")}`,
      );
    }

    const target = await this.resolveTarget(selectedTarget, request.options.abortSignal);
    if (!target.host) throw new Error(`Cast device has no reachable address: ${target.name}`);
    let gateway: SessionMediaGatewayHandle | null = null;
    let mediaUrl = request.stream.url;
    let contentType: string;
    if (compatibility.kind === "gateway-required") {
      const unsupportedGatewayReasons = compatibility.reasons.filter(
        (reason) => reason !== "headers",
      );
      if (unsupportedGatewayReasons.length > 0) {
        throw new CastGatewayRequiredError(unsupportedGatewayReasons);
      }
      gateway = await this.runtime.gateway.start({
        stream: request.stream,
        receiverHost: target.host,
      });
      this.activeGateway = gateway;
      mediaUrl = gateway.mediaUrl;
      contentType = gateway.contentType;
    } else {
      contentType = compatibility.contentType;
    }
    const subtitleSources = [
      ...(request.stream.subtitle
        ? [{ url: request.stream.subtitle, display: "Selected subtitle" }]
        : []),
      ...(request.stream.subtitleList ?? []),
    ].filter((track, index, all) => all.findIndex((item) => item.url === track.url) === index);
    let subtitleGateway: CastSubtitleGatewayHandle | null = null;
    if (subtitleSources.length > 0) {
      subtitleGateway = await (this.runtime.subtitles ?? new CastSubtitleGateway()).start({
        tracks: subtitleSources,
        receiverHost: target.host,
        headers: request.stream.headers,
      });
      this.activeSubtitleGateway = subtitleGateway;
    }
    const emit = (event: PlayerPlaybackEvent) =>
      request.options.onPlaybackEvent?.({ generation: CAST_EVENT_GENERATION, event });
    emit({ type: "launching-player" });

    let lastPosition = request.options.startAt ?? 0;
    let duration = 0;
    let started = false;
    let paused = false;
    let mediaLoadAccepted = false;
    let activeMediaSessionId: number | undefined;
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

    let session: GoogleCastSession;
    this.lastKnownPosition = request.options.startAt ?? 0;
    this.lastKnownPositionObservedAt = (this.runtime.now ?? Date.now)();
    this.positionAdvancing = false;
    try {
      session = await this.runtime.connect(
        { host: target.host, port: target.port ?? 8009 },
        {
          onStatus: (status) => {
            if (
              activeMediaSessionId !== undefined &&
              status.mediaSessionId !== undefined &&
              status.mediaSessionId !== activeMediaSessionId
            ) {
              return;
            }
            if (typeof status.currentTime === "number") {
              lastPosition = status.currentTime;
              this.lastKnownPosition = status.currentTime;
              this.lastKnownPositionObservedAt = (this.runtime.now ?? Date.now)();
            }
            if (typeof status.media?.duration === "number") duration = status.media.duration;
            if (status.playerState === "PLAYING") {
              this.positionAdvancing = true;
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
              this.positionAdvancing = false;
              if (!paused) emit({ type: "playback-paused" });
              paused = true;
              this.paused = true;
            } else if (status.playerState === "BUFFERING") {
              this.positionAdvancing = false;
              emit({ type: "network-buffering" });
            } else if (status.playerState === "IDLE" && mediaLoadAccepted && status.idleReason) {
              this.positionAdvancing = false;
              finish(
                status.idleReason === "FINISHED"
                  ? "eof"
                  : status.idleReason === "ERROR"
                    ? "error"
                    : "quit",
              );
            }
            if (status.playerState === "PLAYING") this.paused = false;
          },
          onReceiverClock: (clock) => {
            if (typeof clock.currentTime === "number") {
              lastPosition = clock.currentTime;
              this.lastKnownPosition = clock.currentTime;
              this.lastKnownPositionObservedAt = (this.runtime.now ?? Date.now)();
            }
            if (typeof clock.duration === "number") duration = clock.duration;
            this.positionAdvancing = clock.state === "PLAYING";
            if (clock.state === "PLAYING") {
              if (!started) {
                started = true;
                emit({ type: "playback-started" });
              }
              emit({
                type: "playback-progress",
                positionSeconds: lastPosition,
                durationSeconds: duration,
              });
            }
          },
          onError: () => finish("error"),
          onClose: () => {
            this.positionAdvancing = false;
            finish(started ? "quit" : "error");
          },
        },
        withTimeoutSignal(request.options.abortSignal, 8_000),
        this.receiverAppId,
      );
    } catch (error) {
      gateway?.close();
      subtitleGateway?.close();
      if (this.activeGateway === gateway) this.activeGateway = null;
      if (this.activeSubtitleGateway === subtitleGateway) this.activeSubtitleGateway = null;
      throw error;
    }
    this.activeSession = session;
    const controlId = `google-cast:${target.id}`;
    if (this.registerPlayerControls)
      this.playerControl?.setActive({
        id: controlId,
        stop: () => this.stop(),
        togglePause: async () => {
          if (paused) await this.resume();
          else await this.pause();
        },
        seekRelative: async (seconds) => {
          await this.seek(Math.max(0, lastPosition + seconds));
        },
        seekAbsolute: async (seconds) => {
          await this.seek(Math.max(0, seconds));
        },
        getStatsSnapshot: () => ({
          positionSeconds: lastPosition,
          durationSeconds: duration,
          updatedAt: Date.now(),
        }),
      });
    emit({ type: "opening-stream" });
    const media: GoogleCastMedia = {
      contentId: mediaUrl,
      contentType,
      streamType: request.stream.isLive ? "LIVE" : "BUFFERED",
      metadata: { metadataType: 0, title: request.options.displayTitle },
      ...(subtitleGateway?.tracks.length
        ? {
            tracks: subtitleGateway.tracks.map((track) => ({
              trackId: track.trackId,
              type: "TEXT" as const,
              trackContentId: track.url,
              trackContentType: "text/vtt" as const,
              subtype: "SUBTITLES" as const,
              name: track.name,
              ...(track.language ? { language: track.language } : {}),
            })),
          }
        : {}),
    };
    let initialStatus;
    try {
      initialStatus = await session.load(
        media,
        request.options.startAt ?? 0,
        subtitleGateway?.tracks[0] ? [subtitleGateway.tracks[0].trackId] : undefined,
      );
      activeMediaSessionId = initialStatus.mediaSessionId;
      mediaLoadAccepted = true;
    } catch (error) {
      session.close();
      gateway?.close();
      subtitleGateway?.close();
      if (this.activeSession === session) this.activeSession = null;
      if (this.activeGateway === gateway) this.activeGateway = null;
      if (this.activeSubtitleGateway === subtitleGateway) this.activeSubtitleGateway = null;
      if (this.playerControl?.getActive()?.id === controlId) this.playerControl.setActive(null);
      throw error;
    }
    request.options.onPlayerReady?.();
    emit({ type: "player-ready" });

    if (initialStatus.playerState === "PLAYING") {
      if (typeof initialStatus.currentTime === "number") {
        lastPosition = initialStatus.currentTime;
        this.lastKnownPosition = initialStatus.currentTime;
      }
      this.lastKnownPositionObservedAt = (this.runtime.now ?? Date.now)();
      this.positionAdvancing = true;
      started = true;
      emit({ type: "playback-started" });
    } else if (initialStatus.playerState === "IDLE" && initialStatus.idleReason) {
      finish(initialStatus.idleReason === "FINISHED" ? "eof" : "error");
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
      this.positionAdvancing = false;
      request.options.abortSignal?.removeEventListener("abort", abort);
      if (this.activeSession === session) this.activeSession = null;
      if (this.playerControl?.getActive()?.id === controlId) this.playerControl.setActive(null);
      session.close();
      gateway?.close();
      subtitleGateway?.close();
      if (this.activeGateway === gateway) this.activeGateway = null;
      if (this.activeSubtitleGateway === subtitleGateway) this.activeSubtitleGateway = null;
    }
  }

  pause(): Promise<unknown> {
    return this.activeSession?.pause() ?? Promise.resolve();
  }

  resume(): Promise<unknown> {
    return this.activeSession?.play() ?? Promise.resolve();
  }

  togglePause(): Promise<unknown> {
    return this.paused ? this.resume() : this.pause();
  }

  seek(seconds: number): Promise<unknown> {
    return this.activeSession?.seek(seconds) ?? Promise.resolve();
  }

  getPosition(): number | null {
    if (!this.activeSession) return null;
    return extrapolateCastPosition(
      this.lastKnownPosition,
      this.lastKnownPositionObservedAt,
      (this.runtime.now ?? Date.now)(),
      this.positionAdvancing,
    );
  }

  async stop(): Promise<void> {
    const session = this.activeSession;
    const gateway = this.activeGateway;
    const subtitleGateway = this.activeSubtitleGateway;
    try {
      if (session) {
        this.positionAdvancing = false;
        await session.stop();
        session.close();
        if (this.activeSession === session) this.activeSession = null;
      }
    } finally {
      gateway?.close();
      subtitleGateway?.close();
      if (this.activeGateway === gateway) this.activeGateway = null;
      if (this.activeSubtitleGateway === subtitleGateway) this.activeSubtitleGateway = null;
    }
  }
}
