import type { FollowedTitleRepository } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";

import type { AttentionRefreshCandidate } from "./AttentionRefreshScheduler";

export function buildAttentionRefreshCandidates(input: {
  readonly rows: readonly HistoryProgress[];
  readonly followedTitleRepository: Pick<FollowedTitleRepository, "listByPreference">;
  readonly mutedTitleIds?: ReadonlySet<string>;
  readonly visibleTitleIds?: ReadonlySet<string>;
  readonly lastCheckedAtByTitleId?: ReadonlyMap<string, string>;
}): readonly AttentionRefreshCandidate[] {
  const followedIds = new Set(
    input.followedTitleRepository.listByPreference("following").map((record) => record.titleId),
  );
  const muted = input.mutedTitleIds ?? new Set<string>();
  const visible = input.visibleTitleIds ?? new Set<string>();
  const seen = new Set<string>();
  const candidates: AttentionRefreshCandidate[] = [];

  for (const row of input.rows) {
    if (seen.has(row.titleId)) continue;
    seen.add(row.titleId);
    candidates.push({
      id: row.titleId,
      visible: visible.has(row.titleId),
      followed: followedIds.has(row.titleId),
      muted: muted.has(row.titleId),
      lastCheckedAt: input.lastCheckedAtByTitleId?.get(row.titleId),
    });
  }

  for (const titleId of followedIds) {
    if (seen.has(titleId)) continue;
    seen.add(titleId);
    candidates.push({
      id: titleId,
      visible: visible.has(titleId),
      followed: true,
      muted: muted.has(titleId),
      lastCheckedAt: input.lastCheckedAtByTitleId?.get(titleId),
    });
  }

  return candidates;
}
