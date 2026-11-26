// =============================================================================
// Config Service
//
// Manages user configuration and preferences.
// =============================================================================

import type { StremioAddonsConsent } from "@/domain/provider/stremio-addons";

import type { TuningConfig } from "./tuning";

export type {
  ConfigTuningOverrides,
  ContinueSourcePreference,
  DiscoverMode,
  HdrMode,
  KitsuneConfig as BaseKitsuneConfig,
  MediaLanguageProfile,
  PresencePrivacy,
  PresenceProvider,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
  RecoveryMode,
} from "@kunai/config";
export {
  DEFAULT_CONFIG,
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
  mergeKitsuneConfig,
  parseKitsuneConfigPartial,
  parseProviderRelayConfig,
} from "@kunai/config";

import type { KitsuneConfig as BaseKitsuneConfig } from "@kunai/config";

/** CLI config shape with typed tuning overrides. */
export interface KitsuneConfig extends BaseKitsuneConfig {
  tuningOverrides?: Partial<TuningConfig>;
}

export type AnalyticsPingCompletion = {
  readonly installId: string;
  readonly analyticsRetryAfter: number;
  readonly lastAnalyticsPingAt?: number;
  /**
   * The cohort the ping carried, for an install that had none stored (it opted
   * in before cohorts existed). Written only if the file still has none.
   */
  readonly analyticsCohort?: string;
};

/** What the explicit rotate action writes: a new identity and a fresh cadence. */
export type AnalyticsIdentityRotation = Pick<
  BaseKitsuneConfig,
  "installId" | "analyticsCohort" | "lastAnalyticsPingAt" | "analyticsRetryAfter"
>;

/** Analytics consent and install id exactly as config.json holds them now. */
export type PersistedAnalyticsConsent = {
  readonly analytics: KitsuneConfig["analytics"];
  readonly installId: string;
};

export interface ConfigService extends KitsuneConfig {
  /** Fully-resolved tuning values (defaults < config override < env). */
  readonly tuning: TuningConfig;
  // Raw config access
  getRaw(): KitsuneConfig;
  update(partial: Partial<KitsuneConfig>): Promise<void>;
  /**
   * Apply launch-flag overrides (`--zen`, `-m`) for this run only. Readers see
   * them; `save()` never does, so a one-run flag cannot be persisted by the
   * unconditional background saves that happen on startup.
   */
  applySessionOverrides(partial: Partial<KitsuneConfig>): void;
  save(): Promise<void>;
  /** Apply bookkeeping only if persisted consent and identity still match. */
  recordAnalyticsPing(completion: AnalyticsPingCompletion): Promise<boolean>;
  /**
   * Compare-and-set for the explicit rotate action: write the new identity only
   * while memory and config.json both still say `enabled`. Otherwise refresh the
   * analytics fields this process has not edited from the file and return
   * false, so a stale process cannot put an identity back beside `disabled`.
   */
  rotateAnalyticsIdentity(rotation: AnalyticsIdentityRotation): Promise<boolean>;
  /**
   * Re-read config.json's analytics consent and install id, as a sibling
   * process may have left them. Memory is not touched, so a pending local change
   * keeps waiting for its own save. The read goes through the normal store load:
   * a missing or corrupt file resolves to the defaults (`unset`, which never
   * sends), and a corrupt file is quarantined exactly as at startup. A read that
   * rejects is treated by the analytics gate as "do not send" as well.
   */
  readPersistedAnalyticsConsent(): Promise<PersistedAnalyticsConsent>;
  /**
   * Refresh one installed addon's stored display name from its manifest.
   * Merges over the live file under the store lock and the persist chain, so
   * another process's entries and unrelated keys survive; an addon removed in
   * the meantime is not re-added. Display-only — callers tolerate failure.
   */
  recordStremioAddonName(manifestUrl: string, name: string): Promise<void>;
  /** Persist any debounced pending save immediately (shutdown path). */
  flushPending(): Promise<void>;
  reset(): Promise<void>;
  /**
   * The Stremio addon opt-in as the live config file records it, with any
   * pending local edits winning. A standalone `kunai addons enable|disable`
   * writes the file directly, so a running session reads this rather than its
   * boot-time snapshot — a disable stops the next resolve. Fail-closed: an
   * absent or unreadable file reports off.
   */
  readStremioAddonsConsent?(): StremioAddonsConsent;
}

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
}
