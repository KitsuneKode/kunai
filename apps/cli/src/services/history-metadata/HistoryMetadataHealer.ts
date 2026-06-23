// =============================================================================
// HistoryMetadataHealer.ts — best-effort self-healing of history metadata
//
// Resolves catalog metadata (poster, external IDs) for history titles that were
// stored without it and backfills the rows. Once external IDs exist, the normal
// release-reconciliation pipeline can learn the title's episode total, which in
// turn lets the history bucket classifier recognise finished series as completed
// instead of stranding them in "continue". IO is delegated to a resolver port so
// the orchestration stays pure-testable.
// =============================================================================

import { mergeProviderNativeId } from "@kunai/core";
import type { HistoryProgress } from "@kunai/storage";
import type { ProviderExternalIds } from "@kunai/types";

import { selectHistoryHealTargets, type HistoryHealTarget } from "./select-heal-targets";

export type ResolvedHistoryMetadata = {
  readonly posterUrl?: string;
  readonly externalIds?: ProviderExternalIds;
};

export interface HistoryMetadataResolver {
  resolve(target: HistoryHealTarget, signal?: AbortSignal): Promise<ResolvedHistoryMetadata | null>;
}

export interface HistoryMetadataRepo {
  backfillTitleMetadata(
    titleId: string,
    metadata: { readonly posterUrl?: string; readonly externalIds?: ProviderExternalIds },
  ): void;
}

export interface HistoryMetadataHealerDeps {
  readonly resolver: HistoryMetadataResolver;
  readonly repo: HistoryMetadataRepo;
  readonly limit?: number;
  readonly onHealError?: (titleId: string, error: unknown) => void;
}

export class HistoryMetadataHealer {
  constructor(private readonly deps: HistoryMetadataHealerDeps) {}

  /**
   * Resolve + backfill metadata for history titles that lack it. Best-effort: a
   * resolver miss or error for one title never aborts the rest. Returns the title
   * ids that were healed (so the caller can re-enqueue reconciliation for them).
   */
  async heal(
    entries: readonly HistoryProgress[],
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    const targets = selectHistoryHealTargets(entries, { limit: this.deps.limit });
    const healed: string[] = [];

    for (const target of targets) {
      if (signal?.aborted) break;
      let resolved: ResolvedHistoryMetadata | null = null;
      try {
        resolved = await this.deps.resolver.resolve(target, signal);
      } catch (error) {
        this.deps.onHealError?.(target.titleId, error);
        continue;
      }
      if (!resolved && !target.needsProviderNativeMapping) {
        continue;
      }

      let externalIds = target.needsExternalIds ? resolved?.externalIds : target.externalIds;
      if (target.needsProviderNativeMapping && target.providerId) {
        const nativeId = target.titleId.replace(/^allanime:/, "").trim();
        externalIds = mergeProviderNativeId(externalIds, target.providerId, nativeId);
      }

      const posterUrl = target.needsPoster ? resolved?.posterUrl : undefined;
      if (!posterUrl && !hasExternalIds(externalIds)) continue;

      this.deps.repo.backfillTitleMetadata(target.titleId, {
        posterUrl,
        externalIds:
          target.needsExternalIds || target.needsProviderNativeMapping ? externalIds : undefined,
      });
      healed.push(target.titleId);
    }

    return healed;
  }
}

function hasExternalIds(externalIds: ProviderExternalIds | undefined): boolean {
  return Boolean(externalIds && Object.values(externalIds).some(Boolean));
}
