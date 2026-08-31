import { LOCAL_PLAYBACK_TARGET, type PlaybackTarget } from "@/domain/playback/playback-target";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";

import type { PlaybackBackend } from "./PlaybackBackend";

export type PlaybackRouterPort = Pick<PlaybackRouter, "play">;

/** Selects a playback implementation without leaking receiver mechanics upward. */
export class PlaybackRouter {
  private readonly backends: ReadonlyMap<PlaybackTarget["kind"], PlaybackBackend>;
  private target: PlaybackTarget = LOCAL_PLAYBACK_TARGET;
  private generationProcess = 0;

  constructor(backends: readonly PlaybackBackend[]) {
    this.backends = new Map(backends.map((backend) => [backend.kind, backend]));
  }

  getTarget(): PlaybackTarget {
    return this.target;
  }

  selectTarget(target: PlaybackTarget): void {
    if (!this.backends.has(target.kind)) {
      throw new Error(`No playback backend is registered for target kind: ${target.kind}`);
    }
    this.target = target;
  }

  play(
    stream: StreamInfo,
    options: PlayerOptions,
    target: PlaybackTarget = this.target,
  ): Promise<PlaybackResult> {
    const backend = this.backends.get(target.kind);
    if (!backend) {
      throw new Error(`No playback backend is registered for target kind: ${target.kind}`);
    }
    const generation = { process: ++this.generationProcess, cycle: 1 } as const;
    options.onGenerationActivated?.(generation);
    const routedOptions: PlayerOptions = {
      ...options,
      onGenerationActivated: () => undefined,
      onPlaybackEvent: options.onPlaybackEvent
        ? ({ event }) => options.onPlaybackEvent?.({ generation, event })
        : undefined,
    };
    return backend.play({ stream, options: routedOptions }, target);
  }

  async stop(): Promise<void> {
    await this.backends.get(this.target.kind)?.stop?.();
  }
}
