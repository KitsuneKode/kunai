import type { ProviderEndpointHealthRepository } from "@kunai/storage";
import type {
  EndpointFailureClass,
  EndpointHealthFailureInfo,
  EndpointHealthPort,
  ProviderEndpointHealthRecord,
  ProviderId,
} from "@kunai/types";

const HOUR_MS = 60 * 60 * 1000;
const ROUTE_DEAD_QUARANTINE_MS = 24 * HOUR_MS;
const SERVER_ERROR_QUARANTINE_MS = 1 * HOUR_MS;

/**
 * Consecutive `server-error` failures on a single endpoint that justify a
 * quarantine on their own. The two-distinct-titles rule exists to avoid
 * blacklisting an endpoint over one title's quirk, but normal viewing stays on
 * one title, so that rule alone never fired in practice.
 */
const SINGLE_TITLE_QUARANTINE_FAILURES = 3;
const TRANSIENT_COOLDOWN_MS = 60_000;

export type EndpointHealthSeed = {
  readonly providerId: ProviderId;
  readonly endpoint: string;
  readonly failureClass: "route-dead";
};

type Repository = Pick<
  ProviderEndpointHealthRepository,
  "get" | "set" | "isQuarantined" | "delete" | "deleteByProvider" | "clearAll" | "list"
>;

export class ProviderEndpointHealthService implements EndpointHealthPort {
  private readonly transientCooldowns = new Map<string, number>();
  private readonly transientFailureCounts = new Map<string, number>();
  private readonly curatedDead = new Set<string>();

  constructor(
    private readonly repository: Repository,
    private readonly now: () => Date = () => new Date(),
    seeds: readonly EndpointHealthSeed[] = [],
  ) {
    for (const seed of seeds) {
      this.curatedDead.add(this.key(seed.providerId, seed.endpoint));
    }
  }

  shouldTry(providerId: ProviderId, endpoint: string): boolean {
    const key = this.key(providerId, endpoint);
    if (this.curatedDead.has(key)) {
      const nowIso = this.now().toISOString();
      const record = this.repository.get(providerId, endpoint);
      if (!record?.quarantinedUntil) {
        return false;
      }
      if (Date.parse(record.quarantinedUntil) > Date.parse(nowIso)) {
        return false;
      }
      this.curatedDead.delete(key);
    }

    const nowIso = this.now().toISOString();
    if (this.repository.isQuarantined(providerId, endpoint, nowIso)) {
      return false;
    }

    return this.shouldTryTransient(key);
  }

  recordFailure(providerId: ProviderId, endpoint: string, info: EndpointHealthFailureInfo): void {
    const now = this.now();
    const nowIso = now.toISOString();
    const existing = this.repository.get(providerId, endpoint);
    const distinctTitleIds = mergeDistinctTitleIds(existing, info.titleId);
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;

    if (info.class === "transient") {
      this.recordTransientFailure(this.key(providerId, endpoint));
      return;
    }

    const quarantinedUntil = resolveQuarantineUntil({
      failureClass: info.class,
      distinctTitleIds,
      consecutiveFailures,
      now,
    });

    const record: ProviderEndpointHealthRecord = {
      providerId,
      endpoint,
      failureClass: info.class,
      consecutiveFailures,
      distinctTitleIds,
      quarantinedUntil,
      lastFailureAt: info.at,
      updatedAt: nowIso,
    };
    this.repository.set(record);
  }

  recordSuccess(providerId: ProviderId, endpoint: string): void {
    const key = this.key(providerId, endpoint);
    this.clearTransient(key);
    this.repository.delete(providerId, endpoint);
    this.curatedDead.delete(key);
  }

  /**
   * Forget every endpoint row for one provider, including in-memory transient
   * cooldowns, sub-threshold transient failure counts, and curated dead seeds.
   * Re-observed failures re-quarantine, so over-clearing on an explicit user reset
   * only costs a few requests.
   */
  deleteByProvider(providerId: ProviderId): number {
    const prefix = `${providerId}:`;
    for (const key of this.transientCooldowns.keys()) {
      if (key.startsWith(prefix)) this.clearTransient(key);
    }
    for (const key of this.transientFailureCounts.keys()) {
      if (key.startsWith(prefix)) this.clearTransient(key);
    }
    for (const key of this.curatedDead) {
      if (key.startsWith(prefix)) this.curatedDead.delete(key);
    }
    return this.repository.deleteByProvider(providerId);
  }

  /**
   * Forget endpoint rows that mention a title. Quarantine evidence is keyed by
   * provider+endpoint (not by title), so a per-show reset can only lift rows
   * this title contributed to — rows with no title evidence stay quarantined.
   */
  clearTitle(titleId: string, providerId?: ProviderId): number {
    let cleared = 0;
    for (const record of this.repository.list()) {
      if (providerId && record.providerId !== providerId) continue;
      if (!record.distinctTitleIds.includes(titleId)) continue;
      this.clearTransient(this.key(record.providerId, record.endpoint));
      this.curatedDead.delete(this.key(record.providerId, record.endpoint));
      cleared += this.repository.delete(record.providerId, record.endpoint);
    }
    return cleared;
  }

  clearAll(): number {
    this.transientCooldowns.clear();
    this.transientFailureCounts.clear();
    this.curatedDead.clear();
    return this.repository.clearAll();
  }

  isQuarantined(providerId: ProviderId, endpoint: string): boolean {
    return !this.shouldTry(providerId, endpoint);
  }

  private key(providerId: ProviderId, endpoint: string): string {
    return `${providerId}:${endpoint}`;
  }

  private shouldTryTransient(key: string): boolean {
    const cooldownUntil = this.transientCooldowns.get(key);
    if (!cooldownUntil) return true;
    if (Date.now() >= cooldownUntil) {
      this.clearTransient(key);
      return true;
    }
    return false;
  }

  private recordTransientFailure(key: string): void {
    const count = (this.transientFailureCounts.get(key) ?? 0) + 1;
    this.transientFailureCounts.set(key, count);
    if (count >= 2) {
      this.transientCooldowns.set(key, Date.now() + TRANSIENT_COOLDOWN_MS);
    }
  }

  private clearTransient(key: string): void {
    this.transientCooldowns.delete(key);
    this.transientFailureCounts.delete(key);
  }
}

function mergeDistinctTitleIds(
  existing: ProviderEndpointHealthRecord | undefined,
  titleId: string | undefined,
): readonly string[] {
  const merged = new Set(existing?.distinctTitleIds ?? []);
  if (titleId) merged.add(titleId);
  return [...merged];
}

function resolveQuarantineUntil(input: {
  readonly failureClass: Exclude<EndpointFailureClass, "transient">;
  readonly distinctTitleIds: readonly string[];
  readonly consecutiveFailures: number;
  readonly now: Date;
}): string | undefined {
  if (input.failureClass === "route-dead") {
    return new Date(input.now.getTime() + ROUTE_DEAD_QUARANTINE_MS).toISOString();
  }

  if (
    input.failureClass === "server-error" &&
    (input.distinctTitleIds.length >= 2 ||
      input.consecutiveFailures >= SINGLE_TITLE_QUARANTINE_FAILURES)
  ) {
    return new Date(input.now.getTime() + SERVER_ERROR_QUARANTINE_MS).toISOString();
  }

  return undefined;
}
