// =============================================================================
// Config Service Implementation
// =============================================================================

import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import { normalizeAutoDownloadNextCount } from "@/services/download/download-scope-policy";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
} from "@/services/download/StorageBudgetPolicy";
import { MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS } from "@kunai/config";
import { migrateLegacyProviderId } from "@kunai/providers";
import { normalizeRelayBaseUrl as normalizeRelayBaseUrlValue } from "@kunai/relay";
import { isJsonString, type ProviderRelayConfig, type StartupPriority } from "@kunai/types";

import type {
  ConfigService,
  KitsuneConfig,
  AutoDownloadMode,
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

function asConfigString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function noteMalformed(repaired: string[] | undefined, field: string): void {
  if (repaired && !repaired.includes(field)) repaired.push(field);
}

function normalizeSeriesProvider(
  value: unknown,
  fallback = DEFAULT_CONFIG.provider,
  field?: string,
  repaired?: string[],
): string {
  if (value !== undefined && typeof value !== "string")
    noteMalformed(repaired, field ?? "provider");
  const normalized = asConfigString(value)?.trim();
  if (!normalized) return fallback;
  return migrateLegacyProviderId(normalized);
}

function normalizeProviderIdList(
  values: unknown,
  fallback: readonly string[] = [],
  field?: string,
  repaired?: string[],
): readonly string[] {
  if (values === undefined) return fallback.map(migrateLegacyProviderId);
  if (!Array.isArray(values)) {
    noteMalformed(repaired, field ?? "providerPriority");
    return fallback.map(migrateLegacyProviderId);
  }
  let droppedNonString = false;
  const normalized = values.map((value) => {
    if (typeof value !== "string") {
      droppedNonString = true;
      return "";
    }
    return migrateLegacyProviderId(value.trim());
  });
  if (droppedNonString) noteMalformed(repaired, field ?? "providerPriority");
  return [...new Set(normalized.filter(Boolean))];
}

function normalizeDefaultSubtitleLanguage(subLang: unknown): string {
  if (typeof subLang !== "string") return DEFAULT_CONFIG.subLang;
  if (!subLang || subLang === "none" || subLang === "fzf" || subLang === "interactive") {
    return DEFAULT_CONFIG.subLang;
  }
  return subLang;
}

function normalizeSubtitlePreference(value: string | undefined): string {
  if (!value) return "none";
  if (value === "fzf") return "interactive";
  return value;
}

function normalizeQualityPreference(value: unknown, field?: string, repaired?: string[]): string {
  if (value !== undefined && typeof value !== "string") {
    noteMalformed(repaired, field ?? "defaultDownloadQuality");
    return "best";
  }
  const normalized = asConfigString(value)?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "best";
  return normalized;
}

function normalizeLanguageProfile(
  profile: KitsuneConfig["animeLanguageProfile"] | undefined,
): KitsuneConfig["animeLanguageProfile"] {
  if (!profile) return { audio: "original", subtitle: "none", quality: "best" };
  return {
    audio: profile.audio,
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

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;
  /**
   * Transient launch-flag overrides (`--zen`, `-m`, `--offline`). Held apart
   * from `config` so a save applies only dirty keys and can never bake a
   * one-run flag into the user's config file.
   */
  private sessionOverrides: Partial<KitsuneConfig> = {};
  /** Keys this process changed since the last successful merge onto disk. */
  private dirtyKeys = new Set<keyof KitsuneConfig>();
  /**
   * Known fields whose JSON type was wrong at load. Recovered to the field
   * default; the rest of the file is kept. Bootstrap logs this list.
   */
  repairedConfigFields: readonly string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimeoutMs = 300;
  /** Set when load() auto-migrated legacy videasyAppId to bc-frontend. */
  videasyAppIdMigratedOnLoad = false;

  constructor(
    private store: ConfigStore,
    private vault?: CredentialVaultPort,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /** Whether the vault holds the videasy token — hydrated or migrated this session. */
  private videasyTokenVaulted = false;

  static async load(store: ConfigStore, vault?: CredentialVaultPort): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store, vault);
    const loaded = await store.load();
    // Configs written before explicit consent had no notice marker. Their
    // enabled value was opt-out state, not evidence of a current opt-in, so
    // revoke it and erase the old local identifier before startup can send.
    const requiresExplicitAnalyticsConsent =
      loaded.analytics === "enabled" && typeof loaded.analyticsNoticeShown !== "boolean";
    const normalizedAnalytics = requiresExplicitAnalyticsConsent
      ? "unset"
      : normalizeAnalyticsPreference(loaded.analytics);
    const normalizedInstallId =
      normalizedAnalytics === "enabled" && typeof loaded.installId === "string"
        ? loaded.installId.trim()
        : "";
    const repairedAnalyticsIdentity =
      loaded.installId !== undefined && loaded.installId !== normalizedInstallId;
    const migratedAnimeDefaults = shouldMigrateInheritedAnimeDefaults(loaded);
    const migratedSeriesDefaults = shouldMigrateInheritedSeriesDefaults(loaded);
    const repaired: string[] = [];
    service.config = {
      ...DEFAULT_CONFIG,
      ...loaded,
      ...(migratedSeriesDefaults
        ? {
            provider: DEFAULT_CONFIG.provider,
            providerPriority: [...DEFAULT_CONFIG.providerPriority],
          }
        : {
            provider: normalizeSeriesProvider(
              loaded.provider,
              DEFAULT_CONFIG.provider,
              "provider",
              repaired,
            ),
            providerPriority: normalizeProviderIdList(
              loaded.providerPriority,
              DEFAULT_CONFIG.providerPriority,
              "providerPriority",
              repaired,
            ),
          }),
      ...(migratedAnimeDefaults
        ? {
            animeProvider: DEFAULT_CONFIG.animeProvider,
            animeProviderPriority: [...DEFAULT_CONFIG.animeProviderPriority],
          }
        : {
            animeProviderPriority: normalizeProviderIdList(
              loaded.animeProviderPriority,
              DEFAULT_CONFIG.animeProviderPriority,
              "animeProviderPriority",
              repaired,
            ),
          }),
      providerDefaultsRevision: Math.max(
        readProviderDefaultsRevision(loaded),
        CURRENT_PROVIDER_DEFAULTS_REVISION,
      ),
      youtubeProvider: normalizeSeriesProvider(
        loaded.youtubeProvider,
        DEFAULT_CONFIG.youtubeProvider,
        "youtubeProvider",
        repaired,
      ),
      youtubeProviderPriority: normalizeProviderIdList(
        loaded.youtubeProviderPriority,
        DEFAULT_CONFIG.youtubeProviderPriority,
        "youtubeProviderPriority",
        repaired,
      ),
      youtubeLanguageProfile: normalizeLanguageProfile(
        loaded.youtubeLanguageProfile ?? DEFAULT_CONFIG.youtubeLanguageProfile,
      ),
      youtubeMetadata: normalizeYoutubeMetadata(loaded.youtubeMetadata),
      subLang: normalizeDefaultSubtitleLanguage(loaded.subLang),
      animeLanguageProfile: normalizeLanguageProfile(loaded.animeLanguageProfile),
      seriesLanguageProfile: normalizeLanguageProfile(loaded.seriesLanguageProfile),
      movieLanguageProfile: normalizeLanguageProfile(loaded.movieLanguageProfile),
      autoDownload: "off",
      autoDownloadNextCount: normalizeAutoDownloadNextCount(loaded.autoDownloadNextCount),
      offlineFreeSpaceReserveBytes: normalizeBytes(
        loaded.offlineFreeSpaceReserveBytes,
        DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
      ),
      offlineUnknownEpisodeEstimateBytes: normalizeBytes(
        loaded.offlineUnknownEpisodeEstimateBytes,
        DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
      ),
      offlineDefaultRunwayTarget: normalizeRunwayTarget(loaded.offlineDefaultRunwayTarget),
      defaultDownloadQuality: normalizeQualityPreference(
        loaded.defaultDownloadQuality,
        "defaultDownloadQuality",
        repaired,
      ),
      favoriteSources: normalizeStringList(loaded.favoriteSources, "favoriteSources", repaired),
      protectedDownloadJobIds: normalizeStringList(
        loaded.protectedDownloadJobIds,
        "protectedDownloadJobIds",
        repaired,
      ),
      recoveryMode: normalizeRecoveryMode(loaded.recoveryMode),
      continueSourcePreference: normalizeContinueSourcePreference(loaded.continueSourcePreference),
      startupPriority: normalizeStartupPriority(loaded.startupPriority),
      mpvInProcessStreamReconnectMaxAttempts: normalizeMpvReconnectAttempts(
        loaded.mpvInProcessStreamReconnectMaxAttempts,
      ),
      videasySessionToken: normalizeOptionalSecret(loaded.videasySessionToken),
      videasySessionExpiresAt: normalizeVideasySessionExpiresAt(
        loaded.videasySessionExpiresAt,
        loaded.videasySessionToken,
      ),
      videasyAppId: normalizeVideasyAppId(
        loaded.videasyAppId,
        normalizeOptionalSecret(loaded.videasySessionToken),
      ),
      providerRelay: normalizeProviderRelayConfig(loaded.providerRelay),
      titleProviderPreferences: normalizeTitleProviderPreferences(loaded.titleProviderPreferences),
      analytics: normalizedAnalytics,
      analyticsNoticeShown: loaded.analyticsNoticeShown === true,
      installId: normalizedInstallId,
      lastAnalyticsPingAt:
        typeof loaded.lastAnalyticsPingAt === "number" &&
        Number.isFinite(loaded.lastAnalyticsPingAt)
          ? Math.max(0, loaded.lastAnalyticsPingAt)
          : 0,
      analyticsRetryAfter:
        typeof loaded.analyticsRetryAfter === "number" &&
        Number.isFinite(loaded.analyticsRetryAfter)
          ? Math.max(0, loaded.analyticsRetryAfter)
          : 0,
      analyticsEndpoint:
        typeof loaded.analyticsEndpoint === "string" ? loaded.analyticsEndpoint.trim() : "",
    };
    for (const key of Object.keys(loaded) as (keyof KitsuneConfig)[]) {
      if (loaded[key] !== undefined && !configValuesEqual(loaded[key], service.config[key])) {
        service.dirtyKeys.add(key);
      }
    }
    const migratedVideasyAppId = shouldPersistVideasyAppIdMigration(loaded, service.config);
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
        // Vault write/read failed — keep the plaintext. The next save must
        // still write it; a dirty-key merge that omitted the token would drop
        // it the moment some other key was saved.
        if (service.config.videasySessionToken) service.dirtyKeys.add("videasySessionToken");
      }
    }
    service.repairedConfigFields = repaired;
    if (
      requiresExplicitAnalyticsConsent ||
      repairedAnalyticsIdentity ||
      migratedVideasyAppId ||
      videasyVaultResave ||
      migratedAnimeDefaults ||
      migratedSeriesDefaults ||
      repaired.length > 0
    ) {
      await service.persistConfig(service.config);
      service.videasyAppIdMigratedOnLoad = migratedVideasyAppId;
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

  /** Vault the token when this save touches it, and keep it out of the merged patch. */
  private async scrubVideasyTokenPatch(patch: Partial<KitsuneConfig>): Promise<void> {
    if (!this.vault || this.vault.backend === "file") return;
    const token = patch.videasySessionToken ?? "";
    const key = CREDENTIAL_KEYS.videasySessionToken;
    try {
      if (token) {
        await this.vault.set(key, token);
        if ((await this.vault.get(key)) === token) {
          this.videasyTokenVaulted = true;
          patch.videasySessionToken = "";
        }
      } else if (this.videasyTokenVaulted) {
        await this.vault.delete(key);
        this.videasyTokenVaulted = false;
      }
    } catch {
      // Vault unreachable — the patch keeps the plaintext rather than dropping it.
    }
  }

  private read<K extends keyof KitsuneConfig>(key: K): KitsuneConfig[K] {
    if (
      Object.prototype.hasOwnProperty.call(this.sessionOverrides, key) &&
      this.sessionOverrides[key] !== undefined
    ) {
      return this.sessionOverrides[key] as KitsuneConfig[K];
    }
    return this.config[key];
  }

  // Accessors
  get provider(): string {
    return this.read("provider");
  }

  get defaultMode(): KitsuneConfig["defaultMode"] {
    return this.read("defaultMode");
  }

  get animeProvider(): string {
    return this.read("animeProvider");
  }

  get youtubeProvider(): string {
    return this.read("youtubeProvider");
  }

  get youtubeProviderPriority(): readonly string[] {
    return [...this.read("youtubeProviderPriority")];
  }

  get youtubeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.read("youtubeLanguageProfile");
  }

  get youtubeMetadata(): KitsuneConfig["youtubeMetadata"] {
    return { ...this.read("youtubeMetadata") };
  }

  get providerPriority(): readonly string[] {
    return [...this.read("providerPriority")];
  }

  get animeProviderPriority(): readonly string[] {
    return [...this.read("animeProviderPriority")];
  }

  get subLang(): string {
    return this.read("subLang");
  }

  get wyzieApiKey(): string {
    return this.read("wyzieApiKey");
  }

  get animeLang(): "sub" | "dub" {
    return this.read("animeLang");
  }

  get animeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.read("animeLanguageProfile");
  }

  get seriesLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.read("seriesLanguageProfile");
  }

  get movieLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.read("movieLanguageProfile");
  }

  get animeTitlePreference(): "english" | "romaji" | "native" | "provider" {
    return this.read("animeTitlePreference");
  }

  get headless(): boolean {
    return this.read("headless");
  }

  get showMemory(): boolean {
    return this.read("showMemory");
  }

  get autoNext(): boolean {
    return this.read("autoNext");
  }

  get autoplayRecommendations(): boolean {
    return this.read("autoplayRecommendations");
  }

  get favoriteSources(): readonly string[] {
    return this.read("favoriteSources");
  }

  get resumeStartChoicePrompt(): boolean {
    return this.read("resumeStartChoicePrompt");
  }

  get skipRecap(): boolean {
    return this.read("skipRecap");
  }

  get skipIntro(): boolean {
    return this.read("skipIntro");
  }

  get skipPreview(): boolean {
    return this.read("skipPreview");
  }

  get skipCredits(): boolean {
    return this.read("skipCredits");
  }

  get footerHints(): "detailed" | "minimal" {
    return this.read("footerHints");
  }

  get quitNearEndBehavior(): QuitNearEndBehavior {
    return this.read("quitNearEndBehavior");
  }

  get quitNearEndThresholdMode(): QuitNearEndThresholdMode {
    return this.read("quitNearEndThresholdMode");
  }

  get mpvKunaiScriptPath(): string {
    return this.read("mpvKunaiScriptPath");
  }

  get mpvKunaiScriptOpts(): Record<string, string> {
    return { ...this.read("mpvKunaiScriptOpts") };
  }

  get mpvInProcessStreamReconnect(): boolean {
    return this.read("mpvInProcessStreamReconnect");
  }

  get mpvInProcessStreamReconnectMaxAttempts(): number {
    return this.read("mpvInProcessStreamReconnectMaxAttempts");
  }

  get presenceProvider(): PresenceProvider {
    return this.read("presenceProvider");
  }

  get presencePrivacy(): PresencePrivacy {
    return this.read("presencePrivacy");
  }

  get presenceDiscordClientId(): string {
    return this.read("presenceDiscordClientId");
  }

  get presenceDiscordOpenUrl(): string {
    return this.read("presenceDiscordOpenUrl");
  }

  get videasySessionToken(): string {
    if (isExpiredVideasySession(this.read("videasySessionExpiresAt"))) return "";
    return this.read("videasySessionToken");
  }

  get providerRelay(): ProviderRelayConfig {
    const relay = this.read("providerRelay");
    return {
      ...relay,
      providers: { ...relay.providers },
    };
  }

  get videasySessionExpiresAt(): number {
    return this.read("videasySessionExpiresAt");
  }

  get videasyAppId(): KitsuneConfig["videasyAppId"] {
    return this.read("videasyAppId");
  }

  get downloadsEnabled(): boolean {
    return this.read("downloadsEnabled");
  }

  get offlineMode(): boolean {
    return this.read("offlineMode");
  }

  get autoDownload(): AutoDownloadMode {
    return this.read("autoDownload");
  }

  get autoDownloadNextCount(): number {
    return this.read("autoDownloadNextCount");
  }

  get maxConcurrentDownloads(): number {
    return normalizeMaxConcurrentDownloads(this.read("maxConcurrentDownloads"));
  }

  get defaultDownloadQuality(): string {
    return normalizeQualityPreference(this.read("defaultDownloadQuality"));
  }

  get autoCleanupWatched(): boolean {
    return this.read("autoCleanupWatched");
  }

  get recoveryMode(): RecoveryMode {
    return this.read("recoveryMode");
  }

  get continueSourcePreference(): KitsuneConfig["continueSourcePreference"] {
    return this.read("continueSourcePreference");
  }

  get startupPriority(): StartupPriority {
    return this.read("startupPriority");
  }

  get artworkPreviewsEnabled(): boolean {
    return this.read("artworkPreviewsEnabled");
  }

  get offlineArtworkCacheEnabled(): boolean {
    return this.read("offlineArtworkCacheEnabled");
  }

  get offlineFreeSpaceReserveBytes(): number {
    return this.read("offlineFreeSpaceReserveBytes");
  }

  get offlineUnknownEpisodeEstimateBytes(): number {
    return this.read("offlineUnknownEpisodeEstimateBytes");
  }

  get offlineDefaultRunwayTarget(): number {
    return this.read("offlineDefaultRunwayTarget");
  }

  get autoCleanupGraceDays(): number {
    return this.read("autoCleanupGraceDays");
  }

  get protectedDownloadJobIds(): readonly string[] {
    return [...this.read("protectedDownloadJobIds")];
  }

  get titleProviderPreferences(): Record<string, string> {
    return { ...this.read("titleProviderPreferences") };
  }

  get onboardingVersion(): number {
    return this.read("onboardingVersion");
  }

  get downloadPath(): string {
    return this.read("downloadPath");
  }

  get downloadOnboardingDismissed(): boolean {
    return this.read("downloadOnboardingDismissed");
  }

  get playbackKeysSessionsSeen(): number {
    return this.read("playbackKeysSessionsSeen");
  }

  get analytics(): KitsuneConfig["analytics"] {
    return this.read("analytics");
  }

  get analyticsNoticeShown(): boolean {
    return this.read("analyticsNoticeShown");
  }

  get installId(): string {
    return this.read("installId");
  }

  get lastAnalyticsPingAt(): number {
    return this.read("lastAnalyticsPingAt");
  }

  get analyticsRetryAfter(): number {
    return this.read("analyticsRetryAfter");
  }

  get analyticsEndpoint(): string {
    return this.read("analyticsEndpoint");
  }

  get updateChecksEnabled(): boolean {
    return this.read("updateChecksEnabled");
  }

  get autoApplyBinaryUpdates(): boolean {
    return this.read("autoApplyBinaryUpdates");
  }

  get updateCheckIntervalDays(): number {
    return this.read("updateCheckIntervalDays");
  }

  get updateSnoozedUntil(): number {
    return this.read("updateSnoozedUntil");
  }

  get lastUpdateCheckAt(): number {
    return this.read("lastUpdateCheckAt");
  }

  get lastUpdateCheckFailedAt(): number {
    return this.read("lastUpdateCheckFailedAt");
  }

  get lastKnownLatestVersion(): string {
    return this.read("lastKnownLatestVersion");
  }

  get discoverShowOnStartup(): boolean {
    return this.read("discoverShowOnStartup");
  }

  get discoverMode(): "auto" | "unified" | "anime-only" | "series-only" {
    return this.read("discoverMode");
  }

  get discoverItemLimit(): number {
    return this.read("discoverItemLimit");
  }

  get recommendationRailEnabled(): boolean {
    return this.read("recommendationRailEnabled");
  }

  get showWatchTimeStats(): boolean {
    return this.read("showWatchTimeStats");
  }

  get lastCalendarVisitAt(): number {
    return this.read("lastCalendarVisitAt");
  }

  get minimalMode(): boolean {
    return this.read("minimalMode");
  }

  get zenMode(): boolean {
    return this.read("zenMode");
  }

  get powerSaverMode(): boolean {
    return this.read("powerSaverMode");
  }

  get powerSaverAllowManualArtwork(): boolean {
    return this.read("powerSaverAllowManualArtwork");
  }

  get tuning(): TuningConfig {
    return resolveTuning(this.read("tuningOverrides"));
  }

  get sync(): KitsuneConfig["sync"] {
    return this.read("sync");
  }

  get lastWeeklyDigestShownAt(): string | null | undefined {
    return this.read("lastWeeklyDigestShownAt");
  }

  getRaw(): KitsuneConfig {
    return { ...this.config, ...this.sessionOverrides };
  }

  /**
   * Apply launch-flag overrides for this run only. Readers see them; `save()`
   * never does. An explicit `update()` of the same key later in the session
   * clears the override, so changing the setting in `/settings` wins over the
   * flag instead of being silently masked by it.
   */
  applySessionOverrides(partial: Partial<KitsuneConfig>): void {
    this.sessionOverrides = { ...this.sessionOverrides, ...partial };
  }

  async update(partial: Partial<KitsuneConfig>): Promise<void> {
    // SAFETY: Object.keys of a Partial<KitsuneConfig> only yields its keys.
    for (const key of Object.keys(partial) as (keyof KitsuneConfig)[]) {
      if (key in this.sessionOverrides) delete this.sessionOverrides[key];
      this.dirtyKeys.add(key);
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
      ...(partial.autoDownloadNextCount !== undefined
        ? { autoDownloadNextCount: normalizeAutoDownloadNextCount(partial.autoDownloadNextCount) }
        : null),
      ...(partial.autoDownload !== undefined ? { autoDownload: "off" as const } : null),
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
    void (async () => {
      const keys = [...this.dirtyKeys];
      for (const key of keys) this.dirtyKeys.delete(key);
      const patch = dirtyPatch(this.config, keys);
      try {
        if ("videasySessionToken" in patch) await this.scrubVideasyTokenPatch(patch);
        if (keys.length > 0) await this.store.merge(patch);
        resolve?.();
      } catch (error) {
        for (const key of keys) this.dirtyKeys.add(key);
        reject?.(error instanceof Error ? error : String(error));
      } finally {
        if (this.saveInFlight === pending) this.saveInFlight = null;
      }
    })();
    return pending;
  }

  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    this.sessionOverrides = {};
    this.dirtyKeys.clear();
    await this.persistConfig(this.config);
  }
}

function dirtyPatch(
  config: KitsuneConfig,
  keys: readonly (keyof KitsuneConfig)[],
): Partial<KitsuneConfig> {
  const patch: Partial<KitsuneConfig> = {};
  for (const key of keys) assignDirty(patch, key, config[key]);
  return patch;
}

function assignDirty<K extends keyof KitsuneConfig>(
  patch: Partial<KitsuneConfig>,
  key: K,
  value: KitsuneConfig[K],
): void {
  patch[key] = value;
}

function configValuesEqual(left: unknown, right: unknown): boolean {
  return stableConfigValue(left) === stableConfigValue(right);
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableConfigValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function normalizeStringList(
  values: unknown,
  field?: string,
  repaired?: string[],
): readonly string[] {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    noteMalformed(repaired, field ?? "protectedDownloadJobIds");
    return [];
  }
  let droppedNonString = false;
  const normalized = values.map((value) => {
    if (typeof value !== "string") {
      droppedNonString = true;
      return "";
    }
    return value.trim();
  });
  if (droppedNonString) noteMalformed(repaired, field ?? "protectedDownloadJobIds");
  return [...new Set(normalized.filter(Boolean))];
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
