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
