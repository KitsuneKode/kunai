import type { BackgroundWorkScheduler } from "@/services/background/BackgroundWorkScheduler";
import {
  DownloadEnqueueRejectedError,
  type DownloadService,
} from "@/services/download/DownloadService";
import type { HistoryStore } from "@/services/persistence/HistoryStore";
import type {
  OfflineTitlePoliciesRepository,
  ReleaseProgressCacheRepository,
} from "@kunai/storage";

import {
  planOfflineRunway,
  type OfflineEpisodeRef,
  type OfflineRunwayExistingEpisode,
} from "./offline-runway-policy";
import type { OfflineAssetService } from "./OfflineAssetService";

export type OfflineRunwayTrigger = "offline-playback-complete" | "policy-change" | "maintenance";

export type OfflineRunwayResult = {
  readonly titleId: string;
  readonly enqueued: number;
  readonly target: number;
  readonly skipReason?:
    | "not-enrolled"
    | "no-watched-cursor"
    | "no-release-projection"
    | "no-source-intent"
    | "already-healthy"
    | "no-released-deficit"
    | "capacity-blocked"
    | "low-space";
};

export class OfflineRunwayService {
  constructor(
    private readonly deps: {
      readonly policies: Pick<OfflineTitlePoliciesRepository, "get" | "upsert">;
      readonly assets: Pick<OfflineAssetService, "listTitleAssets">;
      readonly historyStore: Pick<HistoryStore, "listByTitle">;
      readonly releaseProgressCache: Pick<ReleaseProgressCacheRepository, "getByTitleIds">;
      readonly downloadService: Pick<
        DownloadService,
        "getJob" | "hasJobForEpisode" | "enqueue" | "processQueue"
      >;
      readonly scheduler: Pick<BackgroundWorkScheduler, "enqueue" | "drain">;
      readonly diagnostics?: { record(input: Record<string, unknown>): void };
      readonly isPowerSaver?: () => boolean;
    },
  ) {}

  enqueueEvaluation(titleId: string, trigger: OfflineRunwayTrigger): void {
    if (this.deps.isPowerSaver?.() && trigger !== "policy-change") return;
    this.deps.scheduler.enqueue({
      id: `offline-runway:${titleId}`,
      lane: "offline-runway",
      run: async () => {
        await this.evaluateTitle(titleId, trigger);
      },
    });
    void this.deps.scheduler.drain();
  }

  async evaluateTitle(
    titleId: string,
    trigger: OfflineRunwayTrigger,
  ): Promise<OfflineRunwayResult> {
    const policy = this.deps.policies.get(titleId);
    if (!policy?.enrolled) return { titleId, enqueued: 0, target: 0, skipReason: "not-enrolled" };
    const entries = await this.deps.historyStore.listByTitle(titleId);
    const cursor = highestEpisode(entries);
    if (!cursor) {
      return {
        titleId,
        enqueued: 0,
        target: policy.runwayTarget,
        skipReason: "no-watched-cursor",
      };
    }
    const projection = this.deps.releaseProgressCache.getByTitleIds([titleId]).get(titleId);
    if (!projection) {
      return {
        titleId,
        enqueued: 0,
        target: policy.runwayTarget,
        skipReason: "no-release-projection",
      };
    }
    const assets = this.deps.assets.listTitleAssets(titleId);
    const sourceJob = assets
      .map((asset) =>
        asset.originJobId ? this.deps.downloadService.getJob(asset.originJobId) : undefined,
      )
      .find((job) => job !== undefined);
    if (!sourceJob) {
      return {
        titleId,
        enqueued: 0,
        target: policy.runwayTarget,
        skipReason: "no-source-intent",
      };
    }
    const existingEpisodes: OfflineRunwayExistingEpisode[] = assets.flatMap((asset) =>
      asset.season !== undefined && asset.episode !== undefined
        ? [
            {
              season: asset.season,
              episode: asset.episode,
              state: asset.state === "ready" ? "ready" : "repairable",
            },
          ]
        : [],
    );
    const availableReleasedEpisodes = releasedEpisodesAfterCursor(cursor, projection);
    const plan = planOfflineRunway({
      policy: { enrolled: policy.enrolled, target: policy.runwayTarget },
      watchedCursor: cursor,
      existingEpisodes,
      availableReleasedEpisodes,
      storage: { allowedNewAssets: 1 },
    });
    let enqueued = 0;
    try {
      for (const episode of plan.enqueue) {
        if (this.deps.downloadService.hasJobForEpisode({ titleId, ...episode })) continue;
        const profile = readProfile(policy.profileJson);
        await this.deps.downloadService.enqueue({
          title: {
            id: titleId,
            name: policy.titleName,
            type: sourceJob.mediaKind === "movie" ? "movie" : "series",
          },
          episode,
          providerId: sourceJob.providerId,
          mode: sourceJob.mode ?? (sourceJob.mediaKind === "anime" ? "anime" : "series"),
          audioPreference: profile.audio,
          subtitlePreference: profile.subtitle,
          qualityPreference: profile.quality,
        });
        enqueued += 1;
      }
    } catch (error) {
      if (error instanceof DownloadEnqueueRejectedError && error.code === "insufficient-disk") {
        this.deps.policies.upsert({
          ...policy,
          pausedReason: "low-space",
          updatedAt: new Date().toISOString(),
        });
        return { titleId, enqueued, target: plan.target, skipReason: "low-space" };
      }
      if (error instanceof DownloadEnqueueRejectedError && error.code === "duplicate-intent") {
        return { titleId, enqueued, target: plan.target, skipReason: "already-healthy" };
      }
      throw error;
    }
    if (enqueued > 0) void this.deps.downloadService.processQueue();
    this.deps.diagnostics?.record({
      category: "download",
      operation: "offline-runway.evaluate",
      message: "Offline continuation runway evaluated",
      context: {
        titleId,
        trigger,
        target: plan.target,
        enqueued,
        skipReason: plan.skipReason ?? null,
      },
    });
    return { titleId, enqueued, target: plan.target, skipReason: plan.skipReason };
  }
}

function highestEpisode(
  entries: readonly { readonly season: number; readonly episode: number }[],
): OfflineEpisodeRef | undefined {
  return [...entries].sort(
    (left, right) => right.season - left.season || right.episode - left.episode,
  )[0];
}

function releasedEpisodesAfterCursor(
  cursor: OfflineEpisodeRef,
  projection: { readonly latestAiredSeason?: number; readonly latestAiredEpisode?: number },
): readonly OfflineEpisodeRef[] {
  if (projection.latestAiredSeason !== undefined && projection.latestAiredSeason !== cursor.season)
    return [];
  const last = projection.latestAiredEpisode;
  if (last === undefined || last <= cursor.episode) return [];
  return Array.from({ length: last - cursor.episode }, (_, index) => ({
    season: cursor.season,
    episode: cursor.episode + index + 1,
  }));
}

function readProfile(value: string): { audio?: string; subtitle?: string; quality?: string } {
  try {
    const parsed = JSON.parse(value) as { audio?: string; subtitle?: string; quality?: string };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
