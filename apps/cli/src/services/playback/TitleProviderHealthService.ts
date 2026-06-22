import type { TitleProviderHealthRepository } from "@kunai/storage";

import { decideProviderHealthWrite, type ProviderHealthEvidence } from "./ProviderHealthEvidence";

const NORMAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const SEVERE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Repository = Pick<
  TitleProviderHealthRepository,
  "get" | "set" | "delete" | "deleteAllForTitle" | "deleteAll"
>;
export type CountableTitleProviderFailure = "timeout" | "no-streams" | "dead-stream" | "parse";

export class TitleProviderHealthService {
  constructor(
    private readonly repository: Repository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recordFailure(
    titleId: string,
    providerId: string,
    successfulFallbackProviderId: string | undefined,
    input: CountableTitleProviderFailure | ProviderHealthEvidence,
  ): void {
    const evidence = typeof input === "string" ? { errorClass: input } : input;
    const writeDecision = decideProviderHealthWrite(evidence);
    if (writeDecision.action === "skip") return;
    const kind = writeDecision.evidence.errorClass;
    const now = this.now();
    const existing = this.repository.get(titleId, providerId, now);
    const severe = kind === "parse";
    const fallbackCount =
      (existing?.successfulFallbackCount ?? 0) + (successfulFallbackProviderId ? 1 : 0);
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const suggestedProviderId =
      successfulFallbackProviderId &&
      ((consecutiveFailures >= 2 && fallbackCount >= 1) ||
        (failureCount >= 3 && fallbackCount >= 1))
        ? successfulFallbackProviderId
        : existing?.suggestedProviderId;
    const retention = severe ? SEVERE_RETENTION_MS : NORMAL_RETENTION_MS;
    this.repository.set({
      titleId,
      providerId,
      failureCount,
      consecutiveFailures,
      successfulFallbackCount: fallbackCount,
      cleanSuccessCount: 0,
      suggestedProviderId,
      errorClass: kind,
      sourceId: writeDecision.evidence.sourceId,
      serverId: writeDecision.evidence.serverId,
      networkConfidence: writeDecision.evidence.networkConfidence,
      lastFailureAt: now.toISOString(),
      severeUntil: severe
        ? new Date(now.getTime() + SEVERE_RETENTION_MS).toISOString()
        : existing?.severeUntil,
      expiresAt: new Date(now.getTime() + retention).toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  recordCleanSuccess(titleId: string, providerId: string): void {
    const now = this.now();
    const existing = this.repository.get(titleId, providerId, now);
    if (!existing) return;
    if (existing.errorClass !== "parse") {
      this.repository.delete(titleId, providerId);
      return;
    }
    const cleanSuccessCount = existing.cleanSuccessCount + 1;
    if (cleanSuccessCount >= 2) {
      this.repository.delete(titleId, providerId);
      return;
    }
    this.repository.set({
      ...existing,
      consecutiveFailures: 0,
      cleanSuccessCount,
      updatedAt: now.toISOString(),
    });
  }

  getSwitchSuggestion(
    titleId: string,
    providerId: string,
  ): { readonly providerId: string; readonly suggestedProviderId: string } | null {
    const record = this.repository.get(titleId, providerId, this.now());
    if (!record?.suggestedProviderId) return null;
    return { providerId, suggestedProviderId: record.suggestedProviderId };
  }

  clear(titleId: string, providerId?: string): void {
    if (providerId) {
      this.repository.delete(titleId, providerId);
      return;
    }
    this.repository.deleteAllForTitle(titleId);
  }

  clearAll(): void {
    this.repository.deleteAll();
  }
}
