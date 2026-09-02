import type { PlaybackTarget } from "@/domain/playback/playback-target";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";

export type PlaybackBackendRequest = {
  readonly stream: StreamInfo;
  readonly options: PlayerOptions;
};

/** Receiver implementation selected by PlaybackRouter for a target kind. */
export interface PlaybackBackend {
  readonly kind: PlaybackTarget["kind"];
  play(request: PlaybackBackendRequest, target: PlaybackTarget): Promise<PlaybackResult>;
  stop?(): Promise<void>;
}
