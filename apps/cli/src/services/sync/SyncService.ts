import type { HistoryProgress } from "@kunai/storage";

import type { SyncAdapter } from "./SyncAdapter";

export type SyncHealth = "ok" | "warn" | "error" | "disconnected";

export class SyncService {
  private lastPushFailed = false;

  constructor(
    private readonly anilist: SyncAdapter,
    private readonly tmdb: SyncAdapter,
  ) {}

  get adapters(): readonly SyncAdapter[] {
    return [this.anilist, this.tmdb];
  }

  getConnectedAdapters(): SyncAdapter[] {
    return [this.anilist, this.tmdb].filter((a) => a.isConnected());
  }

  getHealth(): SyncHealth {
    const connected = this.getConnectedAdapters();
    if (connected.length === 0) return "disconnected";
    if (this.lastPushFailed) return "warn";
    return "ok";
  }

  async pushWatched(entry: HistoryProgress): Promise<void> {
    const connected = this.getConnectedAdapters();
    if (connected.length === 0) return;

    let anyFailed = false;
    await Promise.all(
      connected.map(async (adapter) => {
        const result = await adapter.pushWatched(entry);
        if (!result.ok) anyFailed = true;
      }),
    );
    this.lastPushFailed = anyFailed;
  }
}
