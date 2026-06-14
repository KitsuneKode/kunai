// =============================================================================
// Config Service Implementation
// =============================================================================

import { normalizeAutoDownloadNextCount } from "@/services/download/download-scope-policy";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
} from "@/services/download/StorageBudgetPolicy";
import { migrateLegacyProviderId } from "@kunai/providers";
import type { StartupPriority } from "@kunai/types";

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
import type { TuningConfig } from "./tuning";
import { resolveTuning } from "./tuning";

function normalizeSeriesProvider(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_CONFIG.provider;
  return migrateLegacyProviderId(normalized);
}

function normalizeProviderIdList(
  values: readonly string[] | undefined,
  fallback: readonly string[] = [],
): readonly string[] {
  if (!Array.isArray(values)) return fallback.map(migrateLegacyProviderId);
  return [...new Set(values.map((value) => migrateLegacyProviderId(value.trim())).filter(Boolean))];
}

function normalizeDefaultSubtitleLanguage(subLang: string | undefined): string {
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

function normalizeQualityPreference(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
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

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimeoutMs = 300;
  /** Set when load() auto-migrated legacy videasyAppId to bc-frontend. */
  videasyAppIdMigratedOnLoad = false;

  constructor(private store: ConfigStore) {
    this.config = { ...DEFAULT_CONFIG };
  }

  static async load(store: ConfigStore): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store);
    const loaded = await store.load();
    service.config = {
      ...DEFAULT_CONFIG,
      ...loaded,
      provider: normalizeSeriesProvider(loaded.provider),
      providerPriority: normalizeProviderIdList(
        loaded.providerPriority,
        DEFAULT_CONFIG.providerPriority,
      ),
      animeProviderPriority: normalizeProviderIdList(
        loaded.animeProviderPriority,
        DEFAULT_CONFIG.animeProviderPriority,
      ),
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
      protectedDownloadJobIds: normalizeStringList(loaded.protectedDownloadJobIds),
      recoveryMode: normalizeRecoveryMode(loaded.recoveryMode),
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
      titleProviderPreferences: normalizeTitleProviderPreferences(loaded.titleProviderPreferences),
    };
    if (shouldPersistVideasyAppIdMigration(loaded, service.config)) {
      await store.save(service.config);
      service.videasyAppIdMigratedOnLoad = true;
    }
    return service;
  }

  // Accessors
  get provider(): string {
    return this.config.provider;
  }

  get defaultMode(): "series" | "anime" {
    return this.config.defaultMode;
  }

  get animeProvider(): string {
    return this.config.animeProvider;
  }

  get providerPriority(): readonly string[] {
    return [...this.config.providerPriority];
  }

  get animeProviderPriority(): readonly string[] {
    return [...this.config.animeProviderPriority];
  }

  get subLang(): string {
    return this.config.subLang;
  }

  get animeLang(): "sub" | "dub" {
    return this.config.animeLang;
  }

  get animeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.animeLanguageProfile;
  }

  get seriesLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.seriesLanguageProfile;
  }

  get movieLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.movieLanguageProfile;
  }

  get animeTitlePreference(): "english" | "romaji" | "native" | "provider" {
    return this.config.animeTitlePreference;
  }

  get headless(): boolean {
    return this.config.headless;
  }

  get showMemory(): boolean {
    return this.config.showMemory;
  }

  get autoNext(): boolean {
    return this.config.autoNext;
  }

  get autoplayRecommendations(): boolean {
    return this.config.autoplayRecommendations;
  }

  get favoriteSources(): readonly string[] {
    return this.config.favoriteSources;
  }

  get resumeStartChoicePrompt(): boolean {
    return this.config.resumeStartChoicePrompt;
  }

  get skipRecap(): boolean {
    return this.config.skipRecap;
  }

  get skipIntro(): boolean {
    return this.config.skipIntro;
  }

  get skipPreview(): boolean {
    return this.config.skipPreview;
  }

  get skipCredits(): boolean {
    return this.config.skipCredits;
  }

  get footerHints(): "detailed" | "minimal" {
    return this.config.footerHints;
  }

  get quitNearEndBehavior(): QuitNearEndBehavior {
    return this.config.quitNearEndBehavior;
  }

  get quitNearEndThresholdMode(): QuitNearEndThresholdMode {
    return this.config.quitNearEndThresholdMode;
  }

  get mpvKunaiScriptPath(): string {
    return this.config.mpvKunaiScriptPath;
  }

  get mpvKunaiScriptOpts(): Record<string, string> {
    return { ...this.config.mpvKunaiScriptOpts };
  }

  get mpvInProcessStreamReconnect(): boolean {
    return this.config.mpvInProcessStreamReconnect;
  }

  get mpvInProcessStreamReconnectMaxAttempts(): number {
    return this.config.mpvInProcessStreamReconnectMaxAttempts;
  }

  get presenceProvider(): PresenceProvider {
    return this.config.presenceProvider;
  }

  get presencePrivacy(): PresencePrivacy {
    return this.config.presencePrivacy;
  }

  get presenceDiscordClientId(): string {
    return this.config.presenceDiscordClientId;
  }

  get presenceDiscordOpenUrl(): string {
    return this.config.presenceDiscordOpenUrl;
  }

  get videasySessionToken(): string {
    if (isExpiredVideasySession(this.config.videasySessionExpiresAt)) return "";
    return this.config.videasySessionToken;
  }

  get videasySessionExpiresAt(): number {
    return this.config.videasySessionExpiresAt;
  }

  get videasyAppId(): KitsuneConfig["videasyAppId"] {
    return this.config.videasyAppId;
  }

  get downloadsEnabled(): boolean {
    return this.config.downloadsEnabled;
  }

  get autoDownload(): AutoDownloadMode {
    return this.config.autoDownload;
  }

  get autoDownloadNextCount(): number {
    return this.config.autoDownloadNextCount;
  }

  get maxConcurrentDownloads(): number {
    return normalizeMaxConcurrentDownloads(this.config.maxConcurrentDownloads);
  }

  get autoCleanupWatched(): boolean {
    return this.config.autoCleanupWatched;
  }

  get recoveryMode(): RecoveryMode {
    return this.config.recoveryMode;
  }

  get startupPriority(): StartupPriority {
    return this.config.startupPriority;
  }

  get artworkPreviewsEnabled(): boolean {
    return this.config.artworkPreviewsEnabled;
  }

  get offlineArtworkCacheEnabled(): boolean {
    return this.config.offlineArtworkCacheEnabled;
  }

  get offlineFreeSpaceReserveBytes(): number {
    return this.config.offlineFreeSpaceReserveBytes;
  }

  get offlineUnknownEpisodeEstimateBytes(): number {
    return this.config.offlineUnknownEpisodeEstimateBytes;
  }

  get offlineDefaultRunwayTarget(): number {
    return this.config.offlineDefaultRunwayTarget;
  }

  get autoCleanupGraceDays(): number {
    return this.config.autoCleanupGraceDays;
  }

  get protectedDownloadJobIds(): readonly string[] {
    return [...this.config.protectedDownloadJobIds];
  }

  get titleProviderPreferences(): Record<string, string> {
    return { ...this.config.titleProviderPreferences };
  }

  get onboardingVersion(): number {
    return this.config.onboardingVersion;
  }

  get downloadPath(): string {
    return this.config.downloadPath;
  }

  get downloadOnboardingDismissed(): boolean {
    return this.config.downloadOnboardingDismissed;
  }

  get updateChecksEnabled(): boolean {
    return this.config.updateChecksEnabled;
  }

  get updateCheckIntervalDays(): number {
    return this.config.updateCheckIntervalDays;
  }

  get updateSnoozedUntil(): number {
    return this.config.updateSnoozedUntil;
  }

  get lastUpdateCheckAt(): number {
    return this.config.lastUpdateCheckAt;
  }

  get lastUpdateCheckFailedAt(): number {
    return this.config.lastUpdateCheckFailedAt;
  }

  get lastKnownLatestVersion(): string {
    return this.config.lastKnownLatestVersion;
  }

  get discoverShowOnStartup(): boolean {
    return this.config.discoverShowOnStartup;
  }

  get discoverMode(): "auto" | "unified" | "anime-only" | "series-only" {
    return this.config.discoverMode;
  }

  get discoverItemLimit(): number {
    return this.config.discoverItemLimit;
  }

  get recommendationRailEnabled(): boolean {
    return this.config.recommendationRailEnabled;
  }

  get showWatchTimeStats(): boolean {
    return this.config.showWatchTimeStats;
  }

  get minimalMode(): boolean {
    return this.config.minimalMode;
  }

  get zenMode(): boolean {
    return this.config.zenMode;
  }

  get powerSaverMode(): boolean {
    return this.config.powerSaverMode;
  }

  get powerSaverAllowManualArtwork(): boolean {
    return this.config.powerSaverAllowManualArtwork;
  }

  get tuning(): TuningConfig {
    return resolveTuning(this.config.tuningOverrides);
  }

  get sync(): KitsuneConfig["sync"] {
    return this.config.sync;
  }

  get syncNudgeDismissedAt(): string | undefined {
    return this.config.syncNudgeDismissedAt;
  }

  get lastWeeklyDigestShownAt(): string | null | undefined {
    return this.config.lastWeeklyDigestShownAt;
  }

  getRaw(): KitsuneConfig {
    return { ...this.config };
  }

  async update(partial: Partial<KitsuneConfig>): Promise<void> {
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

  // Trailing debounce: every call re-arms the timer so the latest config wins,
  // and all callers in a burst share one promise that resolves once the write
  // actually lands. (A previous version cleared the timer but early-returned
  // without rescheduling, which dropped the write and left the promise hung.)
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.savePending) {
      this.savePending = new Promise<void>((resolve) => {
        this.savePendingResolve = resolve;
      });
    }
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      const resolve = this.savePendingResolve;
      this.savePending = null;
      this.savePendingResolve = null;
      try {
        await this.store.save(this.config);
      } finally {
        resolve?.();
      }
    }, this.saveTimeoutMs);
    return this.savePending;
  }

  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.store.save(this.config);
  }
}

function normalizeStringList(values: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeOptionalSecret(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeVideasySessionExpiresAt(value: unknown, token?: unknown): number {
  const expiresAt = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (!normalizeOptionalSecret(token)) return 0;
  return isExpiredVideasySession(expiresAt) ? 0 : expiresAt;
}

function isExpiredVideasySession(expiresAt: number): boolean {
  return expiresAt > 0 && expiresAt <= Date.now();
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

function normalizeVideasyAppId(value: unknown, sessionToken = ""): KitsuneConfig["videasyAppId"] {
  const appId = typeof value === "string" ? value.trim() : "";
  if (appId === "bc-frontend") return "bc-frontend";
  // Legacy persisted default before Cineplay became primary. Without a paired vidking.net
  // session token, the vidking app id resolves embed-tier HLS that stalls in mpv.
  if (appId === "vidking" && normalizeOptionalSecret(sessionToken)) return "vidking";
  return "bc-frontend";
}

function normalizeRecoveryMode(value: unknown): RecoveryMode {
  return value === "fallback-first" || value === "manual" ? value : "guided";
}

function normalizeStartupPriority(value: unknown): StartupPriority {
  return value === "fast" || value === "quality-first" || value === "balanced" ? value : "balanced";
}

function normalizeBytes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function normalizeRunwayTarget(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_OFFLINE_RUNWAY_TARGET;
  return Math.max(1, Math.min(24, Math.trunc(value)));
}

function normalizeMpvReconnectAttempts(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, Math.trunc(value)));
}

function normalizeMaxConcurrentDownloads(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.trunc(value)));
}
