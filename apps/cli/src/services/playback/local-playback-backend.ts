import type { PlaybackTarget } from "@/domain/playback/playback-target";
import type { PlayerService } from "@/infra/player/PlayerService";

import type { PlaybackBackend, PlaybackBackendRequest } from "./playback-backend";
import { PlaybackRouter } from "./playback-router";

/** Preserves the existing mpv handoff behind the receiver-neutral backend seam. */
export class LocalPlaybackBackend implements PlaybackBackend {
  readonly kind = "local" as const;

  constructor(private readonly player: Pick<PlayerService, "play">) {}

  play(request: PlaybackBackendRequest, _target: PlaybackTarget) {
    return this.player.play(request.stream, request.options);
  }
}

export function createLocalPlaybackRouter(player: Pick<PlayerService, "play">): PlaybackRouter {
  return new PlaybackRouter([new LocalPlaybackBackend(player)]);
}
