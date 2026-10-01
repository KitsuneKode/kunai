// =============================================================================
// Config Service Implementation
// =============================================================================

import { dbg } from "@/logger";
import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
} from "@/services/download/StorageBudgetPolicy";
import { MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS } from "@kunai/config";
import { migrateLegacyProviderId } from "@kunai/providers";
import { normalizeRelayBaseUrl as normalizeRelayBaseUrlValue } from "@kunai/relay";
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type ProviderRelayConfig,
  type StartupPriority,
} from "@kunai/types";

import type {
  ConfigService,
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
  PresencePrivacy,
  PresenceProvider,
  RecoveryMode,
} from "./ConfigService";
import type { ConfigStore } from "./ConfigStore";
import { DEFAULT_CONFIG } from "./ConfigStore";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "./credential-vault";
import type { TuningConfig } from "./tuning";
import { resolveTuning } from "./tuning";

function normalizeSeriesProvider<T>(value: T): string {
  const normalized = isJsonString(value) ? value.trim() : "";
  if (!normalized) return DEFAULT_CONFIG.provider;
  return migrateLegacyProviderId(normalized);
}

function normalizeProviderIdList<T>(
  values: readonly T[] | T | undefined,
  fallback: readonly string[] = [],
): readonly string[] {
  if (!Array.isArray(values)) return fallback.map(migrateLegacyProviderId);
  // SAFETY: `values` is narrowed by Array.isArray; items may be non-strings in a
  // hand-edited config, so each item is checked before `.trim()`.
  return [
    ...new Set(
      (values as readonly unknown[])
        .map((value) => (isJsonString(value) ? migrateLegacyProviderId(value.trim()) : ""))
        .filter(Boolean),
    ),
  ];
}

function normalizeDefaultSubtitleLanguage<T>(subLang: T): string {
  if (!isJsonString(subLang)) return DEFAULT_CONFIG.subLang;
  if (!subLang || subLang === "none" || subLang === "fzf" || subLang === "interactive") {
    return DEFAULT_CONFIG.subLang;
  }
  return subLang;
}

function normalizeSubtitlePreference<T>(value: T): string {
  if (!isJsonString(value) || !value) return "none";
  if (value === "fzf") return "interactive";
  return value;
}

function normalizeQualityPreference<T>(value: T): string {
  const normalized = isJsonString(value) ? value.trim().toLowerCase() : "";
  if (!normalized || normalized === "auto") return "best";
  return normalized;
}

function normalizeLanguageProfile(
  profile: KitsuneConfig["animeLanguageProfile"] | undefined,
): KitsuneConfig["animeLanguageProfile"] {
  if (!isJsonObject(profile)) {
    return { audio: "original", subtitle: "none", quality: "best" };
  }
  return {
    audio: isJsonString(profile.audio) && profile.audio ? profile.audio : "original",
    subtitle: normalizeSubtitlePreference(profile.subtitle),
    quality: normalizeQualityPreference(profile.quality),
  };
}

function normalizeTitleProviderPreferences(
  value: Record<string, string> | undefined,
): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const normalized: Record<string, string> = {};
  for (const [titleId, providerId] of Object.entries(value)) {
    if (typeof titleId !== "string" || typeof providerId !== "string") continue;
    const trimmedTitleId = titleId.trim();
    const trimmedProviderId = providerId.trim();
    if (!trimmedTitleId || !trimmedProviderId) continue;
    normalized[trimmedTitleId] = trimmedProviderId;
  }
  return normalized;
}

function normalizeProviderRelayConfig<T>(value: T): ProviderRelayConfig {
  if (!value || typeof value !== "object") return DEFAULT_CONFIG.providerRelay;
  const raw = value as Partial<ProviderRelayConfig>;
  const baseUrl = normalizeRelayBaseUrl(raw.baseUrl);
  const providers: Record<string, { enabled?: boolean }> = {};
  if (raw.providers && typeof raw.providers === "object") {
    for (const [providerId, providerConfig] of Object.entries(raw.providers)) {
      if (!providerId.trim() || !providerConfig || typeof providerConfig !== "object") continue;
      providers[providerId.trim()] = {
        ...(typeof providerConfig.enabled === "boolean"
          ? { enabled: providerConfig.enabled }
          : null),
      };
    }
  }
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : null),
    baseUrl,
    token: normalizeOptionalSecret(raw.token),
    fallbackToDirect: raw.fallbackToDirect !== false,
    providers,
  };
}

function normalizeRelayBaseUrl<T>(value: T): string {
  if (typeof value !== "string") return "";
  return normalizeRelayBaseUrlValue(value) ?? "";
}

/**
 * The config schema validates `providerRelay` only and preserves the rest verbatim,
 * so a hand-edited `config.json` can put a number or an object where a string
 * belongs. `.trim()` on that throws inside `load()`, which takes down startup for a
 * field nothing critical depends on.
 */
function trimmedConfigString<T>(value: T): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeYoutubeMetadata(
  value: KitsuneConfig["youtubeMetadata"] | undefined,
): KitsuneConfig["youtubeMetadata"] {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG.youtubeMetadata };
  const entries = {
    instanceUrl: trimmedConfigString(value.instanceUrl),
    pipedApiUrl: trimmedConfigString(value.pipedApiUrl),
    cookiesFromBrowser: trimmedConfigString(value.cookiesFromBrowser),
    cookiesFile: trimmedConfigString(value.cookiesFile),
    extractorArgs: trimmedConfigString(value.extractorArgs),
    poToken: trimmedConfigString(value.poToken),
    sponsorblockRemove: trimmedConfigString(value.sponsorblockRemove),
  };
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry !== undefined),
  ) as KitsuneConfig["youtubeMetadata"];
}

type ConfigValueClass = "string" | "number" | "boolean" | "array" | "object" | "null";

function configValueClass(value: KitsuneConfig[keyof KitsuneConfig] | undefined): ConfigValueClass {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (isJsonString(value)) return "string";
  if (isJsonNumber(value)) return "number";
  if (value === true || value === false) return "boolean";
  return isJsonObject(value) ? "object" : "null";
}

/**
 * Top-level shape guard for a hand-edited config.json. The store's schema only
 * validates `providerRelay`, so a `{"provider": 42}` survives parsing and used
 * to crash the first per-field normalizer that called `.trim()` on it.
 *
 * Every key present in both the file and `DEFAULT_CONFIG` must match the
 * default's value class (a `null` default also accepts a string — the nullable
 * string fields); anything else is dropped so the default applies. Only key
 * names are reported — never values, which may be user data.
 */
/**
 * Settings that shipped once, never gained a runtime reader, and were removed
 * from `KitsuneConfig`. The permissive parser still accepts files carrying
 * them; this set is what scrubs them out on load (and on the next save) so a
 * stale key cannot masquerade as a live setting. Wrong-typed known keys take
 * the `droppedKeys` lane instead — different diagnosis, different log line.
 */
const RETIRED_CONFIG_KEYS = new Set([
  "autoDownload",
  "autoDownloadNextCount",
  "powerSaverAllowManualArtwork",
]);

type SanitizedConfig = {
  readonly sanitized: Partial<KitsuneConfig>;
  readonly droppedKeys: string[];
  readonly retiredKeys: string[];
};

function sanitizeLoadedConfig(loaded: Partial<KitsuneConfig>): SanitizedConfig {
  const droppedKeys: string[] = [];
  const retiredKeys: string[] = [];
  // `loaded` is the passthrough parser's output: it can carry keys that are no
  // longer in `KitsuneConfig` (retired) or were never in it (unknown). Both
  // survive `{...loaded}` at runtime, so the retired set is deleted explicitly
  // and unknown keys keep flowing through untouched.
  const sanitized = { ...loaded };
  for (const key of Object.keys(sanitized)) {
    if (RETIRED_CONFIG_KEYS.has(key)) {
      // SAFETY: RETIRED_CONFIG_KEYS holds former config field names; keying by
      // them is a best-effort delete — a non-key string is a harmless no-op.
      delete sanitized[key as keyof KitsuneConfig];
      retiredKeys.push(key);
      continue;
    }
    if (!(key in DEFAULT_CONFIG)) continue;
    // SAFETY: guarded by `key in DEFAULT_CONFIG` — key is a known config field.
    const configKey = key as keyof typeof DEFAULT_CONFIG;
    const expected = configValueClass(DEFAULT_CONFIG[configKey]);
    const actual = configValueClass(sanitized[configKey]);
    const accepted =
      expected === "null"
        ? actual === "null" || actual === "string"
        : expected === "number"
          ? actual === "number" && Number.isFinite(sanitized[configKey])
          : actual === expected;
    if (!accepted) {
      delete sanitized[configKey];
      droppedKeys.push(key);
    }
  }
  return { sanitized, droppedKeys, retiredKeys };
}

/**
 * Everything `load()` does to turn raw store bytes into `service.config`: the
 * shape guard, the per-field normalizers, and the analytics-consent and
 * provider-default migrations. Vault hydration and the resave stay in `load()`
 * — this function is pure so `persistPendingSave()` and `reloadFromDisk()` can
 * adopt a fresh disk state without re-running side effects.
 *
 * `needsResave` is the same flag set `load()` persists on: every migration or
 * repair it performed OR'd together.
 */
type NormalizedLoadedConfig = {
  readonly config: KitsuneConfig;
  readonly needsResave: boolean;
  readonly migratedVideasyAppId: boolean;
  readonly droppedKeys: string[];
  readonly retiredKeys: string[];
};

function normalizeLoadedConfig(loaded: Partial<KitsuneConfig>): NormalizedLoadedConfig {
  const { sanitized, droppedKeys, retiredKeys } = sanitizeLoadedConfig(loaded);
  // Configs written before explicit consent had no notice marker. Their
  // enabled value was opt-out state, not evidence of a current opt-in, so
  // revoke it and erase the old local identifier before startup can send.
  const requiresExplicitAnalyticsConsent =
    sanitized.analytics === "enabled" &&
    sanitized.analyticsNoticeShown !== true &&
    sanitized.analyticsNoticeShown !== false;
  const normalizedAnalytics = requiresExplicitAnalyticsConsent
    ? "unset"
    : normalizeAnalyticsPreference(sanitized.analytics);
  const normalizedInstallId =
    normalizedAnalytics === "enabled" && isJsonString(sanitized.installId)
      ? sanitized.installId.trim()
      : "";
  const repairedAnalyticsIdentity =
    sanitized.installId !== undefined && sanitized.installId !== normalizedInstallId;
  const migratedAnimeDefaults = shouldMigrateInheritedAnimeDefaults(sanitized);
  const migratedSeriesDefaults = shouldMigrateInheritedSeriesDefaults(sanitized);
  const config: KitsuneConfig = {
    ...DEFAULT_CONFIG,
    ...sanitized,
    ...(migratedSeriesDefaults
      ? {
          provider: DEFAULT_CONFIG.provider,
          providerPriority: [...DEFAULT_CONFIG.providerPriority],
        }
      : {
          provider: normalizeSeriesProvider(sanitized.provider),
          providerPriority: normalizeProviderIdList(
            sanitized.providerPriority,
            DEFAULT_CONFIG.providerPriority,
          ),
        }),
    ...(migratedAnimeDefaults
      ? {
          animeProvider: DEFAULT_CONFIG.animeProvider,
          animeProviderPriority: [...DEFAULT_CONFIG.animeProviderPriority],
        }
      : {
          animeProviderPriority: normalizeProviderIdList(
            sanitized.animeProviderPriority,
            DEFAULT_CONFIG.animeProviderPriority,
          ),
        }),
    providerDefaultsRevision: Math.max(
      readProviderDefaultsRevision(sanitized),
      CURRENT_PROVIDER_DEFAULTS_REVISION,
    ),
    youtubeProvider:
      normalizeSeriesProvider(sanitized.youtubeProvider) || DEFAULT_CONFIG.youtubeProvider,
    youtubeProviderPriority: normalizeProviderIdList(
      sanitized.youtubeProviderPriority,
      DEFAULT_CONFIG.youtubeProviderPriority,
    ),
    youtubeLanguageProfile: normalizeLanguageProfile(
      sanitized.youtubeLanguageProfile ?? DEFAULT_CONFIG.youtubeLanguageProfile,
    ),
    youtubeMetadata: normalizeYoutubeMetadata(sanitized.youtubeMetadata),
    subLang: normalizeDefaultSubtitleLanguage(sanitized.subLang),
    animeLanguageProfile: normalizeLanguageProfile(sanitized.animeLanguageProfile),
    seriesLanguageProfile: normalizeLanguageProfile(sanitized.seriesLanguageProfile),
    movieLanguageProfile: normalizeLanguageProfile(sanitized.movieLanguageProfile),
    offlineFreeSpaceReserveBytes: normalizeBytes(
      sanitized.offlineFreeSpaceReserveBytes,
      DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
    ),
    offlineUnknownEpisodeEstimateBytes: normalizeBytes(
      sanitized.offlineUnknownEpisodeEstimateBytes,
      DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
    ),
    offlineDefaultRunwayTarget: normalizeRunwayTarget(sanitized.offlineDefaultRunwayTarget),
    protectedDownloadJobIds: normalizeStringList(sanitized.protectedDownloadJobIds),
    recoveryMode: normalizeRecoveryMode(sanitized.recoveryMode),
    continueSourcePreference: normalizeContinueSourcePreference(sanitized.continueSourcePreference),
    startupPriority: normalizeStartupPriority(sanitized.startupPriority),
    mpvInProcessStreamReconnectMaxAttempts: normalizeMpvReconnectAttempts(
      sanitized.mpvInProcessStreamReconnectMaxAttempts,
    ),
    videasySessionToken: normalizeOptionalSecret(sanitized.videasySessionToken),
    videasySessionExpiresAt: normalizeVideasySessionExpiresAt(
      sanitized.videasySessionExpiresAt,
      sanitized.videasySessionToken,
    ),
    videasyAppId: normalizeVideasyAppId(
      sanitized.videasyAppId,
      normalizeOptionalSecret(sanitized.videasySessionToken),
    ),
    providerRelay: normalizeProviderRelayConfig(sanitized.providerRelay),
    titleProviderPreferences: normalizeTitleProviderPreferences(sanitized.titleProviderPreferences),
    analytics: normalizedAnalytics,
    analyticsNoticeShown: sanitized.analyticsNoticeShown === true,
    installId: normalizedInstallId,
    lastAnalyticsPingAt:
      isJsonNumber(sanitized.lastAnalyticsPingAt) && Number.isFinite(sanitized.lastAnalyticsPingAt)
        ? Math.max(0, sanitized.lastAnalyticsPingAt)
        : 0,
    analyticsRetryAfter:
      isJsonNumber(sanitized.analyticsRetryAfter) && Number.isFinite(sanitized.analyticsRetryAfter)
        ? Math.max(0, sanitized.analyticsRetryAfter)
        : 0,
    analyticsEndpoint: isJsonString(sanitized.analyticsEndpoint)
      ? sanitized.analyticsEndpoint.trim()
      : "",
  };
  const migratedVideasyAppId = shouldPersistVideasyAppIdMigration(sanitized, config);
  return {
    config,
    needsResave:
      requiresExplicitAnalyticsConsent ||
      repairedAnalyticsIdentity ||
      migratedVideasyAppId ||
      migratedAnimeDefaults ||
      migratedSeriesDefaults ||
      // Scrub retired keys out of the file on the next save rather than
      // carrying them forever.
      retiredKeys.length > 0,
    migratedVideasyAppId,
    droppedKeys,
    retiredKeys,
  };
}

/**
 * One debug line for keys the shape guard removed. Key names only — the values
 * are user data and `dbg` is the same channel FileStorage's load warnings use.
 */
function logDroppedConfigKeys(droppedKeys: readonly string[]): void {
  if (droppedKeys.length === 0) return;
  dbg("config", "Dropped wrong-typed keys from config.json; defaults are in use", {
    keys: droppedKeys.join(", "),
  });
}

/**
 * Same debug-channel treatment as {@link logDroppedConfigKeys}, distinct
 * message: the key was right-typed but no longer exists, so a user reading
 * "wrong-typed" would go looking for a value problem that isn't there.
 */
function logRetiredConfigKeys(retiredKeys: readonly string[]): void {
  if (retiredKeys.length === 0) return;
  dbg("config", "Ignoring retired keys from config.json; they no longer do anything", {
    keys: retiredKeys.join(", "),
  });
}

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;
  /**
   * Transient launch-flag overrides (`--zen`, `-m`, `--offline`). Held apart
   * from `config` so `save()` — which persists only keys dirtied through
   * `update()`, and which UpdateService and UsageAnalyticsService both call
   * unconditionally on startup — can never bake a one-run flag into the user's
   * config file.
   */
  private sessionOverrides: Partial<KitsuneConfig> = {};
  /**
   * Memoized `{ ...config, ...sessionOverrides }` every accessor reads, so a
   * session override behaves like the setting for this run while never
   * reaching the file. Rebuilt whenever `config` or `sessionOverrides` is
   * reassigned.
   */
  private effectiveView: KitsuneConfig | null = null;
  /**
   * Keys changed through `update()` since the last successful write. Saves
   * merge only these into what is on disk, so a second Kunai process's changes
   * are not clobbered by a stale in-memory snapshot.
   */
  private dirtyKeys = new Set<keyof KitsuneConfig>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimeoutMs = 300;
  /**
   * Values snapshot when a save begins, kept for the duration of its
   * load→write window. `dirtyKeys` is cleared up front, so without this a
   * concurrent `reloadFromDisk()` would see the in-flight keys as untouched
   * and swap their values back to whatever disk holds — the save would then
   * write stale data over the user's change.
   */
  private inFlightValues: Partial<KitsuneConfig> | null = null;
  /** Set when load() auto-migrated legacy videasyAppId to bc-frontend. */
  videasyAppIdMigratedOnLoad = false;

  constructor(
    private store: ConfigStore,
    private vault?: CredentialVaultPort,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  private effective(): KitsuneConfig {
    this.effectiveView ??= { ...this.config, ...this.sessionOverrides };
    return this.effectiveView;
  }

  /** Whether the vault holds the videasy token — hydrated or migrated this session. */
  private videasyTokenVaulted = false;

  static async load(store: ConfigStore, vault?: CredentialVaultPort): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store, vault);
    const loaded = await store.load();
    const normalized = normalizeLoadedConfig(loaded);
    logDroppedConfigKeys(normalized.droppedKeys);
    logRetiredConfigKeys(normalized.retiredKeys);
    service.config = normalized.config;
    // Vault lane: hydrate the in-memory token from the vault when config.json
    // no longer carries it, or migrate plaintext that predates the vault. The
    // scrubbed write below is what removes it from disk — the in-memory config
    // keeps serving it so consumers never learn where it lives.
    let videasyVaultResave = false;
    if (vault && vault.backend !== "file") {
      try {
        const key = CREDENTIAL_KEYS.videasySessionToken;
        if (service.config.videasySessionToken) {
          await vault.set(key, service.config.videasySessionToken);
          if ((await vault.get(key)) === service.config.videasySessionToken) {
            service.videasyTokenVaulted = true;
            videasyVaultResave = true;
          }
        } else {
          const vaulted = await vault.get(key);
          if (vaulted) {
            service.config = { ...service.config, videasySessionToken: vaulted };
            service.videasyTokenVaulted = true;
          }
        }
      } catch {
        // Vault write/read failed — keep the plaintext and retry next launch.
      }
    }
    if (normalized.needsResave || videasyVaultResave) {
      await service.persistConfig(service.config);
      service.videasyAppIdMigratedOnLoad = normalized.migratedVideasyAppId;
    }
    return service;
  }

  /**
   * Persist config.json with vaulted secrets stripped from the on-disk shape.
   * The value lives in the vault; `videasySessionToken` in the file is "".
   * write → read-back → compare before the plaintext is ever omitted, and on
   * any vault failure we fall through to the unscrubbed write so the value is
   * never lost to a failed migration.
   */
  private async persistConfig(config: KitsuneConfig): Promise<void> {
    if (this.vault && this.vault.backend !== "file") {
      const key = CREDENTIAL_KEYS.videasySessionToken;
      const token = config.videasySessionToken;
      try {
        if (token) {
          await this.vault.set(key, token);
          if ((await this.vault.get(key)) === token) {
            this.videasyTokenVaulted = true;
            return await this.store.save({ ...config, videasySessionToken: "" });
          }
        } else if (this.videasyTokenVaulted) {
          await this.vault.delete(key);
          this.videasyTokenVaulted = false;
        }
      } catch {
        // Vault unreachable — persist plaintext rather than drop the value.
      }
    }
    await this.store.save(config);
  }

  // Accessors
  get provider(): string {
    return this.effective().provider;
  }

  get defaultMode(): KitsuneConfig["defaultMode"] {
    return this.effective().defaultMode;
  }

  get animeProvider(): string {
    return this.effective().animeProvider;
  }

  get youtubeProvider(): string {
    return this.effective().youtubeProvider;
  }

  get youtubeProviderPriority(): readonly string[] {
    return [...this.effective().youtubeProviderPriority];
  }

  get youtubeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.effective().youtubeLanguageProfile;
  }

  get youtubeMetadata(): KitsuneConfig["youtubeMetadata"] {
    return { ...this.effective().youtubeMetadata };
  }

  get providerPriority(): readonly string[] {
    return [...this.effective().providerPriority];
  }

  get animeProviderPriority(): readonly string[] {
    return [...this.effective().animeProviderPriority];
  }

  get subLang(): string {
    return this.effective().subLang;
  }

  get wyzieApiKey(): string {
    return this.effective().wyzieApiKey;
  }

  get animeLang(): "sub" | "dub" {
    return this.effective().animeLang;
  }

  get animeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.effective().animeLanguageProfile;
  }

  get seriesLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.effective().seriesLanguageProfile;
  }

  get movieLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.effective().movieLanguageProfile;
  }

  get animeTitlePreference(): "english" | "romaji" | "native" | "provider" {
    return this.effective().animeTitlePreference;
  }

  get headless(): boolean {
    return this.effective().headless;
  }

  get showMemory(): boolean {
    return this.effective().showMemory;
  }

  get autoNext(): boolean {
    return this.effective().autoNext;
  }

  get autoplayRecommendations(): boolean {
    return this.effective().autoplayRecommendations;
  }

  get favoriteSources(): readonly string[] {
    return this.effective().favoriteSources;
  }

  get resumeStartChoicePrompt(): boolean {
    return this.effective().resumeStartChoicePrompt;
  }

  get skipRecap(): boolean {
    return this.effective().skipRecap;
  }

  get skipIntro(): boolean {
    return this.effective().skipIntro;
  }

  get skipPreview(): boolean {
    return this.effective().skipPreview;
  }

  get skipCredits(): boolean {
    return this.effective().skipCredits;
  }

  get footerHints(): "detailed" | "minimal" {
    return this.effective().footerHints;
  }

  get quitNearEndBehavior(): QuitNearEndBehavior {
    return this.effective().quitNearEndBehavior;
  }

  get quitNearEndThresholdMode(): QuitNearEndThresholdMode {
    return this.effective().quitNearEndThresholdMode;
  }

  get mpvKunaiScriptPath(): string {
    return this.effective().mpvKunaiScriptPath;
  }

  get mpvKunaiScriptOpts(): KitsuneConfig["mpvKunaiScriptOpts"] {
    return { ...this.effective().mpvKunaiScriptOpts };
  }

  get mpvInProcessStreamReconnect(): boolean {
    return this.effective().mpvInProcessStreamReconnect;
  }

  get mpvInProcessStreamReconnectMaxAttempts(): number {
    return this.effective().mpvInProcessStreamReconnectMaxAttempts;
  }

  get presenceProvider(): PresenceProvider {
    return this.effective().presenceProvider;
  }

  get presencePrivacy(): PresencePrivacy {
    return this.effective().presencePrivacy;
  }

  get presenceDiscordClientId(): string {
    return this.effective().presenceDiscordClientId;
  }

  get presenceDiscordOpenUrl(): string {
    return this.effective().presenceDiscordOpenUrl;
  }

  get videasySessionToken(): string {
    if (isExpiredVideasySession(this.effective().videasySessionExpiresAt)) return "";
    return this.effective().videasySessionToken;
  }

  get providerRelay(): ProviderRelayConfig {
    return {
      ...this.effective().providerRelay,
      providers: { ...this.effective().providerRelay.providers },
    };
  }

  get videasySessionExpiresAt(): number {
    return this.effective().videasySessionExpiresAt;
  }

  get videasyAppId(): KitsuneConfig["videasyAppId"] {
    return this.effective().videasyAppId;
  }

  get downloadsEnabled(): boolean {
    return this.effective().downloadsEnabled;
  }

  get offlineMode(): boolean {
    return this.effective().offlineMode;
  }

  get maxConcurrentDownloads(): number {
    return normalizeMaxConcurrentDownloads(this.effective().maxConcurrentDownloads);
  }

  get defaultDownloadQuality(): string {
    return normalizeQualityPreference(this.effective().defaultDownloadQuality);
  }

  get autoCleanupWatched(): boolean {
    return this.effective().autoCleanupWatched;
  }

  get recoveryMode(): RecoveryMode {
    return this.effective().recoveryMode;
  }

  get continueSourcePreference(): KitsuneConfig["continueSourcePreference"] {
    return this.effective().continueSourcePreference;
  }

  get startupPriority(): StartupPriority {
    return this.effective().startupPriority;
  }

  get artworkPreviewsEnabled(): boolean {
    return this.effective().artworkPreviewsEnabled;
  }

  get offlineArtworkCacheEnabled(): boolean {
    return this.effective().offlineArtworkCacheEnabled;
  }

  get offlineFreeSpaceReserveBytes(): number {
    return this.effective().offlineFreeSpaceReserveBytes;
  }

  get offlineUnknownEpisodeEstimateBytes(): number {
    return this.effective().offlineUnknownEpisodeEstimateBytes;
  }

  get offlineDefaultRunwayTarget(): number {
    return this.effective().offlineDefaultRunwayTarget;
  }

  get autoCleanupGraceDays(): number {
    return this.effective().autoCleanupGraceDays;
  }

  get protectedDownloadJobIds(): readonly string[] {
    return [...this.effective().protectedDownloadJobIds];
  }

  get titleProviderPreferences(): KitsuneConfig["titleProviderPreferences"] {
    return { ...this.effective().titleProviderPreferences };
  }

  get onboardingVersion(): number {
    return this.effective().onboardingVersion;
  }

  get downloadPath(): string {
    return this.effective().downloadPath;
  }

  get downloadOnboardingDismissed(): boolean {
    return this.effective().downloadOnboardingDismissed;
  }

  get playbackKeysSessionsSeen(): number {
    return this.effective().playbackKeysSessionsSeen;
  }

  get analytics(): KitsuneConfig["analytics"] {
    return this.effective().analytics;
  }

  get analyticsNoticeShown(): boolean {
    return this.effective().analyticsNoticeShown;
  }

  get installId(): string {
    return this.effective().installId;
  }

  get lastAnalyticsPingAt(): number {
    return this.effective().lastAnalyticsPingAt;
  }

  get analyticsRetryAfter(): number {
    return this.effective().analyticsRetryAfter;
  }

  get analyticsEndpoint(): string {
    return this.effective().analyticsEndpoint;
  }

  get updateChecksEnabled(): boolean {
    return this.effective().updateChecksEnabled;
  }

  get autoApplyBinaryUpdates(): boolean {
    return this.effective().autoApplyBinaryUpdates;
  }

  get updateCheckIntervalDays(): number {
    return this.effective().updateCheckIntervalDays;
  }

  get updateSnoozedUntil(): number {
    return this.effective().updateSnoozedUntil;
  }

  get lastUpdateCheckAt(): number {
    return this.effective().lastUpdateCheckAt;
  }

  get lastUpdateCheckFailedAt(): number {
    return this.effective().lastUpdateCheckFailedAt;
  }

  get lastKnownLatestVersion(): string {
    return this.effective().lastKnownLatestVersion;
  }

  get discoverShowOnStartup(): boolean {
    return this.effective().discoverShowOnStartup;
  }

  get discoverMode(): "auto" | "unified" | "anime-only" | "series-only" {
    return this.effective().discoverMode;
  }

  get discoverItemLimit(): number {
    return this.effective().discoverItemLimit;
  }

  get recommendationRailEnabled(): boolean {
    return this.effective().recommendationRailEnabled;
  }

  get showWatchTimeStats(): boolean {
    return this.effective().showWatchTimeStats;
  }

  get lastCalendarVisitAt(): number {
    return this.effective().lastCalendarVisitAt;
  }

  get minimalMode(): boolean {
    return this.effective().minimalMode;
  }

  get zenMode(): boolean {
    return this.effective().zenMode;
  }

  get powerSaverMode(): boolean {
    return this.effective().powerSaverMode;
  }

  get tuning(): TuningConfig {
    return resolveTuning(this.effective().tuningOverrides);
  }

  get sync(): KitsuneConfig["sync"] {
    return this.effective().sync;
  }

  get lastWeeklyDigestShownAt(): string | null | undefined {
    return this.effective().lastWeeklyDigestShownAt;
  }

  getRaw(): KitsuneConfig {
    return { ...this.effective() };
  }

  /**
   * Apply launch-flag overrides for this run only. Readers see them; `save()`
   * never does. An explicit `update()` of the same key later in the session
   * clears the override, so changing the setting in `/settings` wins over the
   * flag instead of being silently masked by it.
   */
  applySessionOverrides(partial: Partial<KitsuneConfig>): void {
    this.sessionOverrides = { ...this.sessionOverrides, ...partial };
    this.effectiveView = null;
  }

  async update(partial: Partial<KitsuneConfig>): Promise<void> {
    // SAFETY: Object.keys of a Partial<KitsuneConfig> only yields its keys.
    for (const key of Object.keys(partial) as (keyof KitsuneConfig)[]) {
      this.dirtyKeys.add(key);
      if (key in this.sessionOverrides) delete this.sessionOverrides[key];
    }
    this.config = {
      ...this.config,
      ...partial,
      ...(partial.subLang !== undefined
        ? { subLang: normalizeDefaultSubtitleLanguage(partial.subLang) }
        : null),
      ...(partial.providerPriority !== undefined
        ? { providerPriority: normalizeProviderIdList(partial.providerPriority) }
        : null),
      ...(partial.animeProviderPriority !== undefined
        ? { animeProviderPriority: normalizeProviderIdList(partial.animeProviderPriority) }
        : null),
      ...(partial.animeLanguageProfile
        ? { animeLanguageProfile: normalizeLanguageProfile(partial.animeLanguageProfile) }
        : null),
      ...(partial.seriesLanguageProfile
        ? { seriesLanguageProfile: normalizeLanguageProfile(partial.seriesLanguageProfile) }
        : null),
      ...(partial.movieLanguageProfile
        ? { movieLanguageProfile: normalizeLanguageProfile(partial.movieLanguageProfile) }
        : null),
      ...(partial.offlineFreeSpaceReserveBytes !== undefined
        ? {
            offlineFreeSpaceReserveBytes: normalizeBytes(
              partial.offlineFreeSpaceReserveBytes,
              DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
            ),
          }
        : null),
      ...(partial.offlineUnknownEpisodeEstimateBytes !== undefined
        ? {
            offlineUnknownEpisodeEstimateBytes: normalizeBytes(
              partial.offlineUnknownEpisodeEstimateBytes,
              DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
            ),
          }
        : null),
      ...(partial.offlineDefaultRunwayTarget !== undefined
        ? { offlineDefaultRunwayTarget: normalizeRunwayTarget(partial.offlineDefaultRunwayTarget) }
        : null),
      ...(partial.protectedDownloadJobIds !== undefined
        ? { protectedDownloadJobIds: normalizeStringList(partial.protectedDownloadJobIds) }
        : null),
      ...(partial.recoveryMode !== undefined
        ? { recoveryMode: normalizeRecoveryMode(partial.recoveryMode) }
        : null),
      ...(partial.continueSourcePreference !== undefined
        ? {
            continueSourcePreference: normalizeContinueSourcePreference(
              partial.continueSourcePreference,
            ),
          }
        : null),
      ...(partial.startupPriority !== undefined
        ? { startupPriority: normalizeStartupPriority(partial.startupPriority) }
        : null),
      ...(partial.mpvInProcessStreamReconnectMaxAttempts !== undefined
        ? {
            mpvInProcessStreamReconnectMaxAttempts: normalizeMpvReconnectAttempts(
              partial.mpvInProcessStreamReconnectMaxAttempts,
            ),
          }
        : null),
      ...(partial.videasySessionToken !== undefined
        ? { videasySessionToken: normalizeOptionalSecret(partial.videasySessionToken) }
        : null),
      ...(partial.providerRelay !== undefined
        ? { providerRelay: normalizeProviderRelayConfig(partial.providerRelay) }
        : null),
      ...(partial.videasySessionExpiresAt !== undefined
        ? {
            videasySessionExpiresAt: normalizeVideasySessionExpiresAt(
              partial.videasySessionExpiresAt,
            ),
          }
        : null),
      ...(partial.videasyAppId !== undefined
        ? {
            videasyAppId: normalizeVideasyAppId(
              partial.videasyAppId,
              partial.videasySessionToken !== undefined
                ? normalizeOptionalSecret(partial.videasySessionToken)
                : this.config.videasySessionToken,
            ),
          }
        : null),
      ...(partial.titleProviderPreferences !== undefined
        ? {
            titleProviderPreferences: normalizeTitleProviderPreferences(
              partial.titleProviderPreferences,
            ),
          }
        : null),
    };
    this.effectiveView = null;
  }

  private savePending: Promise<void> | null = null;
  private savePendingResolve: (() => void) | null = null;
  private savePendingReject: ((reason?: Error | string) => void) | null = null;
  /**
   * The store write started by a fired debounce, until it settles.
   *
   * `savePending` is cleared the moment the write starts, so it alone cannot
   * tell shutdown that a write is still running.
   */
  private saveInFlight: Promise<void> | null = null;

  /**
   * Serializes `persistPendingSave()` runs. Two runs overlapping one
   * load→write window would both merge onto the same disk base — the second
   * write drops keys the first just persisted — and the second run would
   * overwrite the shared `inFlightValues` snapshot the first still needs.
   */
  private persistTail: Promise<void> = Promise.resolve();

  // Trailing debounce: every call re-arms the timer so the latest config wins,
  // and all callers in a burst share one promise that settles once the write
  // actually lands (or rejects, so shutdown can record the failure).
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.savePending) {
      this.savePending = new Promise<void>((resolve, reject) => {
        this.savePendingResolve = resolve;
        this.savePendingReject = reject;
      });
    }
    this.saveTimer = setTimeout(() => {
      // The pending promise carries success/failure to every save() caller.
      this.persistPendingSave().catch(() => {});
    }, this.saveTimeoutMs);
    return this.savePending;
  }

  /** Persist any pending debounced save immediately (shutdown path). */
  async flushPending(): Promise<void> {
    if (this.savePending) {
      await this.persistPendingSave();
      return;
    }
    // A debounce that already fired cleared `savePending` while its store write
    // is still running. Returning here let shutdown reach `process.exit()`
    // under an in-flight write and truncate config.json.
    if (this.saveInFlight) await this.saveInFlight;
  }

  private persistPendingSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const pending = this.savePending;
    if (!pending) return Promise.resolve();
    const resolve = this.savePendingResolve;
    const reject = this.savePendingReject;
    this.savePending = null;
    this.savePendingResolve = null;
    this.savePendingReject = null;
    // Tracked *before* the write starts. `store.save()` throwing synchronously
    // runs the catch and the finally before this assignment would have happened,
    // so assigning afterwards left an already-rejected promise in `saveInFlight`
    // that every later `flushPending()` would await.
    this.saveInFlight = pending;
    // Snapshot at queue time: the write owns exactly what was dirty here, and
    // keys dirtied while the run waits or writes stay dirty for the next save.
    // The snapshot also survives `reloadFromDisk()` — it swaps `this.config`
    // values for keys it sees as untouched (dirtyKeys is already cleared).
    const writing = new Set(this.dirtyKeys);
    const writingValues = pickConfigKeys(this.config, writing);
    this.dirtyKeys.clear();
    const prior = this.persistTail;
    this.persistTail = (async () => {
      // Never overlap a prior run's load→write window: two runs merging the
      // same disk base would each drop the other's just-written keys, and
      // `inFlightValues` is shared so only the live run may own it. A rejected
      // tail must not block this run, hence the catch.
      await prior.catch(() => {});
      this.inFlightValues = writingValues;
      // Merge the snapshot onto what is actually on disk — a second Kunai
      // process may have written since this one loaded (e.g. disabling
      // analytics), and writing the whole in-memory config would resurrect
      // its stale values.
      // Residual race: two processes whose saves land inside one load→write
      // window can still interleave and last-writer-wins. There is deliberately
      // no cross-process lock — the merge only shrinks the window it used to be
      // (whole-process-lifetime staleness down to a single write).
      try {
        const disk = await this.store.load();
        let next: KitsuneConfig;
        if (Object.keys(disk).length === 0) {
          // Missing or unreadable file — same full write as before.
          next = { ...this.config, ...writingValues };
        } else {
          const normalized = normalizeLoadedConfig(disk);
          logDroppedConfigKeys(normalized.droppedKeys);
          logRetiredConfigKeys(normalized.retiredKeys);
          const base = normalized.config;
          if (this.videasyTokenVaulted) {
            // The file holds "" for a vaulted token; keep the in-memory secret.
            base.videasySessionToken = this.config.videasySessionToken;
          }
          next = { ...base, ...writingValues };
        }
        await this.persistConfig(next);
        // Keys dirtied while the write was in flight keep their newer memory
        // value; they stay in `dirtyKeys` and land on the next save.
        this.config = { ...next, ...pickConfigKeys(this.config, this.dirtyKeys) };
        this.effectiveView = null;
        resolve?.();
      } catch (error) {
        // A mid-flight reload may have swapped these keys to disk values —
        // restore the snapshot before re-dirtying so the retry writes them.
        // Keys dirtied mid-flight hold newer values than the snapshot, so the
        // live dirty values go last: without them the retry persists the old.
        this.config = {
          ...this.config,
          ...writingValues,
          ...pickConfigKeys(this.config, this.dirtyKeys),
        };
        this.effectiveView = null;
        for (const key of writing) this.dirtyKeys.add(key);
        reject?.(error instanceof Error ? error : String(error));
      } finally {
        this.inFlightValues = null;
        if (this.saveInFlight === pending) this.saveInFlight = null;
      }
    })();
    return pending;
  }

  /**
   * Re-read config.json and adopt it for every key this process has not
   * touched. Lets a long-running session observe another process's changes —
   * most importantly an analytics opt-out — instead of overwriting or ignoring
   * them. Session overrides are untouched; they are never on disk anyway.
   */
  async reloadFromDisk(): Promise<void> {
    const disk = await this.store.load();
    if (Object.keys(disk).length === 0) return;
    const normalized = normalizeLoadedConfig(disk);
    logDroppedConfigKeys(normalized.droppedKeys);
    logRetiredConfigKeys(normalized.retiredKeys);
    const base = normalized.config;
    if (this.videasyTokenVaulted) {
      base.videasySessionToken = this.config.videasySessionToken;
    }
    // In-flight save values come before dirty keys: a key dirtied after the
    // save's snapshot holds the newer memory value and must win.
    this.config = {
      ...base,
      ...this.inFlightValues,
      ...pickConfigKeys(this.config, this.dirtyKeys),
    };
    this.effectiveView = null;
  }

  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    this.dirtyKeys.clear();
    this.inFlightValues = null;
    this.effectiveView = null;
    await this.persistConfig(this.config);
  }
}

function pickConfigKeys(
  config: KitsuneConfig,
  keys: ReadonlySet<keyof KitsuneConfig>,
): Partial<KitsuneConfig> {
  const picked: Partial<Record<keyof KitsuneConfig, KitsuneConfig[keyof KitsuneConfig]>> = {};
  for (const key of keys) picked[key] = config[key];
  // SAFETY: every assigned member comes from `config[key]` for a known key, so
  // each field keeps its declared type.
  return picked as Partial<KitsuneConfig>;
}

function normalizeStringList<T>(values: readonly T[] | T | undefined): readonly string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.map((value) => (isJsonString(value) ? value.trim() : "")).filter(Boolean)),
  ];
}

function normalizeOptionalSecret<T>(value: T): string {
  return isJsonString(value) ? value.trim() : "";
}

function normalizeVideasySessionExpiresAt<T, U>(value: T, token?: U): number {
  const expiresAt = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (!normalizeOptionalSecret(token)) return 0;
  return isExpiredVideasySession(expiresAt) ? 0 : expiresAt;
}

function isExpiredVideasySession(expiresAt: number): boolean {
  return expiresAt > 0 && expiresAt <= Date.now();
}

const CURRENT_PROVIDER_DEFAULTS_REVISION = DEFAULT_CONFIG.providerDefaultsRevision ?? 0;

function readProviderDefaultsRevision(loaded: Partial<KitsuneConfig>): number {
  const value = loaded.providerDefaultsRevision;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Every anime-lane default a build may have written to disk, keyed by the
 * revision it was written under.
 *
 * `ConfigStore.save` writes the whole merged config, so a default sits on disk
 * for every user who ever saved any setting — and the file cannot tell it apart
 * from a deliberate choice. The exact pair *under the revision it shipped in* is
 * the closest honest signal: anyone who touched the anime lane has something else
 * there, and is left alone. Tying each pair to its revision is what keeps a
 * choice made after a migration: a user stamped with revision 1 who picks AniDB
 * again holds the revision-0 pair, which is only inherited at revision 0.
 * anidb.app answering 503 at the origin makes an inherited anidb pair an
 * outage, not a preference, so moving even a deliberate re-pick to the working
 * default is the honest outcome.
 */
const INHERITED_ANIME_DEFAULTS: readonly {
  readonly revision: number;
  readonly animeProvider: string;
  readonly priorities: readonly (readonly string[] | undefined)[];
}[] = [
  // AniDB alone, before revisions existed. A config older than the priority
  // list has none, and inherited the default by definition.
  {
    revision: 0,
    animeProvider: "anidb",
    priorities: [undefined, ["anidb"], ["anidb", "allanime"]],
  },
  // Revision 1 moved the lane to Miruro, and the list then grew twice in
  // stacked changes. Either list is on disk if a build shipped between them.
  {
    revision: 1,
    animeProvider: "miruro",
    priorities: [
      ["miruro", "anidb", "allanime"],
      ["miruro", "animegg", "anidb", "allanime"],
    ],
  },
  // Revision 2 kept Miruro and filled in the independent backends. On disk it
  // is the pair below; revision 3 moves the lane to HiAnime.
  {
    revision: 2,
    animeProvider: "miruro",
    priorities: [["miruro", "kickassanime", "animegg", "anidb", "allanime"]],
  },
];

function shouldMigrateInheritedAnimeDefaults(loaded: Partial<KitsuneConfig>): boolean {
  const revision = readProviderDefaultsRevision(loaded);
  if (revision >= CURRENT_PROVIDER_DEFAULTS_REVISION) return false;
  const priority = loaded.animeProviderPriority;
  return INHERITED_ANIME_DEFAULTS.some(
    (inherited) =>
      inherited.revision === revision &&
      loaded.animeProvider === inherited.animeProvider &&
      inherited.priorities.some((list) => sameProviderList(list, priority)),
  );
}

function sameProviderList(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  );
}

/**
 * The only movie/series priority list a released binary has written next to a
 * Videasy default.
 *
 * `api.videasy.to` no longer resolves at DNS — an inherited Videasy pair sits
 * on a degraded lane lead, not a preference. As with the anime twin, the
 * exact-pair match is the closest honest signal that the user never touched
 * the lane: a picker write
 * either reorders the priority or sets `provider` alone with the shipped list
 * intact. The vidking-era `provider` value normalizes to `videasy` here, so a
 * config old enough to carry the legacy id still counts as inherited.
 */
const SHIPPED_VIDEASY_DEFAULT_PRIORITIES: ReadonlyArray<readonly string[]> = [
  ["rivestream", "vidlink"],
];

/**
 * Configs stamped before `CURRENT_PROVIDER_DEFAULTS_REVISION` whose series pair
 * is exactly a pair a release once shipped are moved to `DEFAULT_CONFIG`'s
 * series defaults. Anything else — a reordered list, a non-Videasy pick, a
 * hand-edited file — is left alone. A user who re-picks Videasy after the
 * migration writes `provider` alone, which this check no longer matches.
 */
function shouldMigrateInheritedSeriesDefaults(loaded: Partial<KitsuneConfig>): boolean {
  if (readProviderDefaultsRevision(loaded) >= CURRENT_PROVIDER_DEFAULTS_REVISION) return false;
  const provider = typeof loaded.provider === "string" ? loaded.provider.trim() : "";
  if (migrateLegacyProviderId(provider) !== "videasy") return false;
  const priority = loaded.providerPriority;
  if (priority === undefined) return true;
  if (!Array.isArray(priority)) return false;
  return SHIPPED_VIDEASY_DEFAULT_PRIORITIES.some(
    (shipped) =>
      shipped.length === priority.length && shipped.every((id, index) => id === priority[index]),
  );
}

function shouldPersistVideasyAppIdMigration(
  loaded: Partial<KitsuneConfig>,
  normalized: KitsuneConfig,
): boolean {
  return (
    loaded.videasyAppId === "vidking" &&
    !normalizeOptionalSecret(loaded.videasySessionToken) &&
    normalized.videasyAppId === "bc-frontend"
  );
}

function normalizeVideasyAppId<T>(value: T, sessionToken = ""): KitsuneConfig["videasyAppId"] {
  const appId = typeof value === "string" ? value.trim() : "";
  if (appId === "bc-frontend") return "bc-frontend";
  // Legacy persisted default before Cineplay became primary. Without a paired vidking.net
  // session token, the vidking app id resolves embed-tier HLS that stalls in mpv.
  if (appId === "vidking" && normalizeOptionalSecret(sessionToken)) return "vidking";
  return "bc-frontend";
}

function normalizeRecoveryMode<T>(value: T): RecoveryMode {
  return value === "manual" ? "manual" : value === "fallback-first" ? "fallback-first" : "guided";
}

function normalizeContinueSourcePreference<T>(value: T): ContinueSourcePreference {
  return value === "local"
    ? "local"
    : value === "stream"
      ? "stream"
      : value === "ask"
        ? "ask"
        : "auto";
}

function normalizeAnalyticsPreference<T>(value: T): KitsuneConfig["analytics"] {
  return value === "enabled" ? "enabled" : value === "disabled" ? "disabled" : "unset";
}

function normalizeStartupPriority<T>(value: T): StartupPriority {
  return value === "fast" ? "fast" : value === "quality-first" ? "quality-first" : "balanced";
}

function normalizeBytes<T>(value: T, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function normalizeRunwayTarget<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_OFFLINE_RUNWAY_TARGET;
  return Math.max(1, Math.min(24, Math.trunc(value)));
}

function normalizeMpvReconnectAttempts<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS;
  }
  return Math.max(0, Math.min(MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS, Math.trunc(value)));
}

function normalizeMaxConcurrentDownloads<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.trunc(value)));
}
