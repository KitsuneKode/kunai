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

import type { PlayerOptions, PlayerService } from "./PlayerService";

export type HandoffPlaybackErrorReason =
  | "unsupported-stream"
  | "local-source-unsupported"
  | "player-shutting-down"
  | AndroidIntentFailure;

const BLOCKER_COPY: Readonly<Record<HandoffBlocker, string>> = {
  "custom-headers-required": "the stream requires HTTP headers",
  "cookies-required": "the stream requires cookies",
  "yt-dlp-required": "the stream requires yt-dlp",
  "deferred-source": "the provider has not produced a final media URL",
  "unsupported-scheme": "the media URL is not absolute HTTP or HTTPS",
  "external-subtitle-unsupported": "the selected stream requires external subtitles",
  "local-source-unsupported": "local files are not supported by Android handoff",
};

const FAILURE_COPY: Readonly<
  Record<Exclude<HandoffPlaybackErrorReason, "unsupported-stream">, string>
> = {
  "local-source-unsupported": "Android handoff does not support local files yet.",
  "player-shutting-down": "The player is shutting down.",
  "intent-launcher-missing":
    "No Android intent launcher was found. Run `pkg install termux-am` and try again.",
  "player-not-installed": "The requested Android player is not installed.",
  "launch-rejected": "Android rejected the external player launch.",
};

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
  readonly capabilities = DETACHED_HANDOFF_CAPABILITIES;
  private shuttingDown = false;
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
    if (options.abortSignal?.aborted) throw new DOMException("playback aborted", "AbortError");

    const plan = createHandoffPlan({
      stream,
      player: this.target,
      capabilities: this.capabilities,
      localSource: Boolean(options.localPlaybackSource),
    });
    if (!plan.ok) throw new HandoffPlaybackError("unsupported-stream", plan.blockers);

    const launched = await launchAndroidIntent({
      target: plan.player,
      url: plan.url,
      runtime: this.runtime,
    });
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
  }

  async releasePersistentSession(): Promise<void> {}

  killActiveMpvProcessesSync(): void {}

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  async isAvailable(): Promise<boolean> {
    return resolveAndroidIntentCommand({
      target: this.target,
      url: "https://example.invalid/kunai-player-check",
      runtime: this.runtime,
    }).ok;
  }

  async playLocal(_options: { readonly source: LocalPlaybackSource }): Promise<PlaybackResult> {
    throw new HandoffPlaybackError("local-source-unsupported");
  }
}
