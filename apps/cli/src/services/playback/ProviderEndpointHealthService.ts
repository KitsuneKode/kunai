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
const TRANSIENT_COOLDOWN_MS = 60_000;

export type EndpointHealthSeed = {
  readonly providerId: ProviderId;
  readonly endpoint: string;
  readonly failureClass: "route-dead";
};

type Repository = Pick<
  ProviderEndpointHealthRepository,
  "get" | "set" | "isQuarantined" | "delete"
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
  readonly now: Date;
}): string | undefined {
  if (input.failureClass === "route-dead") {
    return new Date(input.now.getTime() + ROUTE_DEAD_QUARANTINE_MS).toISOString();
  }

  if (input.failureClass === "server-error" && input.distinctTitleIds.length >= 2) {
    return new Date(input.now.getTime() + SERVER_ERROR_QUARANTINE_MS).toISOString();
  }

  return undefined;
}
