import type { HandoffBlocker } from "@/domain/playback/handoff-plan";
import { createHandoffPlan } from "@/domain/playback/handoff-plan";
import { DETACHED_HANDOFF_CAPABILITIES } from "@/domain/playback/player-capabilities";
import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import {
  defaultAndroidIntentRuntime,
  launchAndroidIntent,
  resolveAndroidIntentCommand,
  type AndroidIntentFailure,
  type AndroidIntentRuntime,
} from "@/infra/player/android-intent-launcher";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { materializeDeferredMediaDocument } from "@/services/playback/deferred-media-materializer";

import type { PlayerOptions, PlayerService } from "./PlayerService";
import {
  getSharedStreamGateway,
  stopSharedStreamGateway,
  type StreamGatewayDocument,
} from "./stream-gateway";

export type HandoffPlaybackErrorReason =
  | "unsupported-stream"
  | "local-source-unsupported"
  | "local-source-unavailable"
  | "player-shutting-down"
  | AndroidIntentFailure;

const BLOCKER_COPY = {
  "custom-headers-required": "the stream requires HTTP headers",
  "cookies-required": "the stream requires cookies",
  "yt-dlp-required": "the stream requires yt-dlp",
  "deferred-source": "the provider has not produced a final media URL",
  "unsupported-scheme": "the media URL is not absolute HTTP or HTTPS",
  "external-subtitle-unsupported": "the selected stream requires external subtitles",
  "local-source-unsupported": "the local media path does not match the verified offline source",
} satisfies Readonly<Record<HandoffBlocker, string>>;

const FAILURE_COPY = {
  "local-source-unsupported": "The local media path does not match the verified offline source.",
  "local-source-unavailable": "The local file is missing or unreadable.",
  "player-shutting-down": "The player is shutting down.",
  "intent-launcher-missing":
    "No Android intent launcher was found. Run `pkg install termux-am` and try again.",
  "player-not-installed": "The requested Android player is not installed.",
  "launch-rejected": "Android rejected the external player launch.",
} satisfies Readonly<Record<Exclude<HandoffPlaybackErrorReason, "unsupported-stream">, string>>;

export class HandoffPlaybackError extends Error {
  override readonly name = "HandoffPlaybackError";

  constructor(
    readonly reason: HandoffPlaybackErrorReason,
    readonly blockers: readonly HandoffBlocker[] = [],
    detail?: string,
  ) {
    const message =
      reason === "unsupported-stream"
        ? `This stream cannot be handed off: ${blockers
            .map((blocker) => BLOCKER_COPY[blocker])
            .join("; ")}.`
        : `${FAILURE_COPY[reason]}${detail ? ` ${detail}` : ""}`;
    super(message);
  }
}

export class HandoffPlayerService implements PlayerService {
  readonly capabilities: PlayerService["capabilities"] = Object.freeze({
    ...DETACHED_HANDOFF_CAPABILITIES,
    localFiles: true,
  });
  private shuttingDown = false;
  private readonly shutdown = new AbortController();
  private activeHandoff: AbortController | undefined;
  private readonly target: DetachedPlayerTarget;
  private readonly runtime: AndroidIntentRuntime;

  constructor(input: {
    readonly target: DetachedPlayerTarget;
    readonly runtime?: AndroidIntentRuntime;
  }) {
    this.target = input.target;
    this.runtime = input.runtime ?? defaultAndroidIntentRuntime;
  }

  async play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> {
    if (this.shuttingDown) throw new HandoffPlaybackError("player-shutting-down");
    const signal = this.beginHandoff(options.abortSignal);

    if (options.localPlaybackSource) {
      return this.playAuthorizedLocal(stream, options.localPlaybackSource, signal);
    }

    // A deferred locator becomes an in-memory MPD the gateway can serve; when
    // it is expired or unknown the plan reports deferred-source as before.
    let document: StreamGatewayDocument | undefined;
    let deferredCleanup: (() => Promise<void>) | undefined;
    if (stream.deferredLocator?.trim()) {
      try {
        const materialized = await materializeDeferredMediaDocument(stream);
        document = {
          text: materialized.text,
          contentType: materialized.contentType,
          remoteUrls: materialized.remoteUrls,
        };
        deferredCleanup = materialized.cleanup;
      } catch {
        // Fall through: the plan still reports the deferred blocker.
      }
    }

    const subtitles = collectHandoffSubtitles(stream);
    const needsGateway =
      Boolean(document) ||
      Object.values(stream.headers).some((value) => value.trim().length > 0) ||
      subtitles.length > 0;

    const plan = createHandoffPlan({
      stream,
      player: this.target,
      capabilities: this.capabilities,
      localSource: Boolean(options.localPlaybackSource),
      gateway: needsGateway
        ? {
            serveHeaders: true,
            serveExternalSubtitles: this.target !== "chooser",
            serveDocument: Boolean(document),
          }
        : undefined,
    });
    if (!plan.ok) {
      await deferredCleanup?.();
      throw new HandoffPlaybackError("unsupported-stream", plan.blockers);
    }

    let release = () => {
      void deferredCleanup?.().catch(() => {});
    };
    try {
      signal.throwIfAborted();
      let url = plan.url;
      let subtitleExtras: readonly string[] = [];
      if (needsGateway) {
        const gateway = getSharedStreamGateway();
        const session = gateway.registerSession({
          url: document ? undefined : stream.url,
          headers: stream.headers,
          subtitles,
          document,
        });
        release = this.retainSession(signal, session.stop, deferredCleanup);
        url = session.mediaUrl;
        subtitleExtras = session.subtitleUrls;
      }

      const launched = await launchAndroidIntent({
        target: plan.player,
        url,
        subtitles: subtitleExtras,
        runtime: this.runtime,
        signal,
      });
      signal.throwIfAborted();
      if (!launched.ok) {
        throw new HandoffPlaybackError(launched.reason, [], launched.detail);
      }

      return Object.freeze({
        watchedSeconds: 0,
        duration: 0,
        endReason: "unknown",
        resultSource: "handoff",
        handoff: Object.freeze({
          accepted: true,
          player: plan.player,
          launcher: launched.launcher,
        }),
      });
    } catch (error) {
      release();
      throw error;
    }
  }

  private beginHandoff(abortSignal?: AbortSignal): AbortSignal {
    this.activeHandoff?.abort(new DOMException("playback superseded", "AbortError"));
    const controller = new AbortController();
    this.activeHandoff = controller;
    const signal = AbortSignal.any([
      controller.signal,
      this.shutdown.signal,
      ...(abortSignal ? [abortSignal] : []),
    ]);
    signal.throwIfAborted();
    return signal;
  }

  /** Keep only this handoff's token alive until cancellation, replacement or shutdown. */
  private retainSession(
    signal: AbortSignal,
    stop: () => void,
    cleanup?: () => Promise<void>,
  ): () => void {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener("abort", release);
      stop();
      void cleanup?.().catch(() => {});
    };
    signal.addEventListener("abort", release, { once: true });
    if (signal.aborted) release();
    return release;
  }

  async releasePersistentSession(): Promise<void> {}

  killActiveMpvProcessesSync(): void {}

  beginShutdown(): void {
    this.shuttingDown = true;
    this.shutdown.abort(new DOMException("playback aborted", "AbortError"));
    stopSharedStreamGateway();
  }

  async isAvailable(): Promise<boolean> {
    return resolveAndroidIntentCommand({
      target: this.target,
      url: "https://example.invalid/kunai-player-check",
      runtime: this.runtime,
    }).ok;
  }

  async playLocal(options: { readonly source: LocalPlaybackSource }): Promise<PlaybackResult> {
    if (this.shuttingDown) throw new HandoffPlaybackError("player-shutting-down");
    const signal = this.beginHandoff();
    const stream: StreamInfo = {
      url: options.source.filePath,
      headers: {},
      timestamp: 1,
      subtitle: options.source.subtitlePath,
    };
    return this.playAuthorizedLocal(stream, options.source, signal);
  }

  private async playAuthorizedLocal(
    stream: StreamInfo,
    source: LocalPlaybackSource,
    signal: AbortSignal,
  ): Promise<PlaybackResult> {
    if (stream.url !== source.filePath) {
      throw new HandoffPlaybackError("unsupported-stream", ["local-source-unsupported"]);
    }

    const subtitles = collectHandoffSubtitles(stream);
    if (this.target === "chooser" && (Boolean(source.subtitlePath) || subtitles.length > 0)) {
      throw new HandoffPlaybackError("unsupported-stream", ["external-subtitle-unsupported"]);
    }

    const gateway = getSharedStreamGateway();
    let session: Awaited<ReturnType<StreamGateway["registerLocalSession"]>>;
    try {
      session = await gateway.registerLocalSession({ source, signal });
    } catch {
      signal.throwIfAborted();
      throw new HandoffPlaybackError("local-source-unavailable");
    }

    const release = this.retainSession(signal, session.stop);
    try {
      signal.throwIfAborted();
      const launched = await launchAndroidIntent({
        target: this.target,
        url: session.mediaUrl,
        subtitles: session.subtitleUrls,
        runtime: this.runtime,
        signal,
      });
      signal.throwIfAborted();
      if (!launched.ok) {
        throw new HandoffPlaybackError(launched.reason, [], launched.detail);
      }

      return Object.freeze({
        watchedSeconds: 0,
        duration: 0,
        endReason: "unknown",
        resultSource: "handoff",
        handoff: Object.freeze({
          accepted: true,
          player: this.target,
          launcher: launched.launcher,
        }),
      });
    } catch (error) {
      release();
      throw error;
    }
  }
}

type StreamGateway = ReturnType<typeof getSharedStreamGateway>;

function collectHandoffSubtitles(stream: StreamInfo): readonly string[] {
  const urls: string[] = [];
  if (stream.subtitle?.trim()) urls.push(stream.subtitle.trim());
  for (const track of stream.subtitleList ?? []) {
    if (track.sourceKind === "embedded") continue;
    const url = track.url.trim();
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
