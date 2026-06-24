export type PlaybackIntent =
  | {
      readonly type: "playback-action";
      readonly action: "next" | "previous" | "pick-quality" | "refresh";
    }
  | { readonly type: "provider-switch"; readonly seq: number }
  | { readonly type: "cancel-active-work" };

/**
 * Single queue for playback gestures that today land in multiple mailboxes.
 * Phase 4 slice: explicit bus behind existing control surfaces.
 */
export class PlaybackIntentBus {
  private readonly queue: PlaybackIntent[] = [];
  private readonly subscribers = new Set<() => void>();

  publish(intent: PlaybackIntent): void {
    this.queue.push(intent);
    this.notify();
  }

  drain(): readonly PlaybackIntent[] {
    const pending = [...this.queue];
    this.queue.length = 0;
    return pending;
  }

  peek(): readonly PlaybackIntent[] {
    return [...this.queue];
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener();
    }
  }
}
