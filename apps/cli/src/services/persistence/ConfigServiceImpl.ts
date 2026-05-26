// =============================================================================
// Config Service Implementation
// =============================================================================

import { normalizeAutoDownloadNextCount } from "@/services/download/download-scope-policy";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
} from "@/services/download/StorageBudgetPolicy";
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

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimeoutMs = 300;

  constructor(private store: ConfigStore) {
    this.config = { ...DEFAULT_CONFIG };
  }

  static async load(store: ConfigStore): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store);
    const loaded = await store.load();
    service.config = {
      ...DEFAULT_CONFIG,
      ...loaded,
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
    };
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

  get downloadsEnabled(): boolean {
    return this.config.downloadsEnabled;
  }

  get autoDownload(): AutoDownloadMode {
    return this.config.autoDownload;
  }

  get autoDownloadNextCount(): number {
    return this.config.autoDownloadNextCount;
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

  get minimalMode(): boolean {
    return this.config.minimalMode;
  }

  get powerSaverMode(): boolean {
    return this.config.powerSaverMode;
  }

  get powerSaverAllowManualArtwork(): boolean {
    return this.config.powerSaverAllowManualArtwork;
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
    };
  }

  private savePending: Promise<void> | null = null;

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.savePending) {
      return this.savePending;
    }
    this.savePending = new Promise<void>((resolve) => {
      this.saveTimer = setTimeout(async () => {
        this.saveTimer = null;
        try {
          await this.store.save(this.config);
        } finally {
          this.savePending = null;
          resolve();
        }
      }, this.saveTimeoutMs);
    });
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
