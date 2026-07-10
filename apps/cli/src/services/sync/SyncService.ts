import type { HistoryProgress } from "@kunai/storage";

import type { SyncAdapter } from "./SyncAdapter";

export type SyncHealth = "ok" | "warn" | "error" | "disconnected";

export type SyncPushSummary = {
  readonly connected: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failures: readonly string[];
};

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

  async pushWatched(entry: HistoryProgress): Promise<SyncPushSummary> {
    const connected = this.getConnectedAdapters();
    if (connected.length === 0) {
      return { connected: 0, succeeded: 0, failed: 0, failures: [] };
    }

    const results = await Promise.all(
      connected.map(async (adapter) => {
        try {
          const result = await adapter.pushWatched(entry);
          return result.ok
            ? { ok: true as const }
            : { ok: false as const, failure: `${adapter.displayName}: ${result.error}` };
        } catch (error) {
          return {
            ok: false as const,
            failure: `${adapter.displayName}: ${error instanceof Error ? error.message : "sync failed"}`,
          };
        }
      }),
    );
    const failures = results.flatMap((result) => (result.ok ? [] : [result.failure]));
    const summary = {
      connected: connected.length,
      succeeded: results.length - failures.length,
      failed: failures.length,
      failures,
    };
    this.lastPushFailed = summary.failed > 0;
    return summary;
  }
}
