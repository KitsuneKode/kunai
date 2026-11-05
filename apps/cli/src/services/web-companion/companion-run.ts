import type { StreamGateway } from "@/infra/player/stream-gateway";

import { CompanionCatalogStore } from "./companion-catalog";

export type CompanionPlaybackView = {
  readonly state: "idle" | "starting" | "playing" | "handed-off" | "ended" | "failed";
  readonly title?: string;
  readonly error?: string;
};
type WorkKind = "search" | "episodes" | "media" | "player";

/** Owns one companion run; browser release never erases search identity or another player. */
export class CompanionRunState {
  readonly catalog = new CompanionCatalogStore();
  playback: CompanionPlaybackView = { state: "idle" };
  gateway: StreamGateway | null = null;
  gatewayStop: (() => void) | null = null;
  private readonly work = new Map<WorkKind, AbortController>();
  private closed = false;
  private mediaId: string | null = null;

  beginWork(kind: WorkKind, requestSignal?: AbortSignal) {
    this.work.get(kind)?.abort();
    const controller = new AbortController();
    if (this.closed) controller.abort();
    this.work.set(kind, controller);
    return {
      controller,
      signal: AbortSignal.any([
        controller.signal,
        ...(requestSignal ? [requestSignal] : []),
        AbortSignal.timeout(30_000),
      ]),
    };
  }

  isAlive(kind: WorkKind, controller: AbortController): boolean {
    return !this.closed && !controller.signal.aborted && this.work.get(kind) === controller;
  }

  stopPlayback(): boolean {
    const pending = this.playback.state === "starting" || this.playback.state === "playing";
    this.work.get("player")?.abort();
    this.work.delete("player");
    this.playback = { state: "idle" };
    return pending;
  }

  /** Replacement owns a new opaque generation; stale pages cannot revoke it. */
  startMedia(mediaId: string): void {
    this.clearMedia();
    this.mediaId = mediaId;
  }

  releaseMedia(mediaId: string): boolean {
    if (mediaId !== this.mediaId) return false;
    this.clearMedia();
    return true;
  }

  private clearMedia(): void {
    this.mediaId = null;
    this.work.get("media")?.abort();
    this.work.delete("media");
    this.gatewayStop?.();
    this.gatewayStop = null;
  }

  close(): void {
    this.closed = true;
    for (const controller of this.work.values()) controller.abort();
    this.work.clear();
    this.clearMedia();
    this.gateway?.stop();
    this.gateway = null;
    this.catalog.clear();
  }
}
