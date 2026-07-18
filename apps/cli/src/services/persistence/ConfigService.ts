// =============================================================================
// Config Service
//
// Manages user configuration and preferences.
// =============================================================================

import type { TuningConfig } from "./tuning";

export type {
  AutoDownloadMode,
  ConfigTuningOverrides,
  ContinueSourcePreference,
  DiscoverMode,
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

export interface ConfigService extends KitsuneConfig {
  /** Fully-resolved tuning values (defaults < config override < env). */
  readonly tuning: TuningConfig;
  // Raw config access
  getRaw(): KitsuneConfig;
  update(partial: Partial<KitsuneConfig>): Promise<void>;
  save(): Promise<void>;
  /** Persist any debounced pending save immediately (shutdown path). */
  flushPending(): Promise<void>;
  reset(): Promise<void>;
}

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
}
