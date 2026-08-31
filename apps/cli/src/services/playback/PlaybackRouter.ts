import { LOCAL_PLAYBACK_TARGET, type PlaybackTarget } from "@/domain/playback/playback-target";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";

import type { PlaybackBackend } from "./PlaybackBackend";

export type PlaybackRouterPort = Pick<PlaybackRouter, "play">;

/** Selects a playback implementation without leaking receiver mechanics upward. */
export class PlaybackRouter {
  private readonly backends: ReadonlyMap<PlaybackTarget["kind"], PlaybackBackend>;

  constructor(backends: readonly PlaybackBackend[]) {
    this.backends = new Map(backends.map((backend) => [backend.kind, backend]));
  }

  play(
    stream: StreamInfo,
    options: PlayerOptions,
    target: PlaybackTarget = LOCAL_PLAYBACK_TARGET,
  ): Promise<PlaybackResult> {
    const backend = this.backends.get(target.kind);
    if (!backend) {
      throw new Error(`No playback backend is registered for target kind: ${target.kind}`);
    }
    return backend.play({ stream, options }, target);
  }
}
