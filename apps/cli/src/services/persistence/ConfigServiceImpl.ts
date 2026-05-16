// =============================================================================
// Config Service Implementation
// =============================================================================

import { normalizeAutoDownloadNextCount } from "@/services/download/download-scope-policy";

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

function normalizeLanguageProfile(
  profile: KitsuneConfig["animeLanguageProfile"] | undefined,
): KitsuneConfig["animeLanguageProfile"] {
  if (!profile) return { audio: "original", subtitle: "none" };
  return {
    audio: profile.audio,
    subtitle: normalizeSubtitlePreference(profile.subtitle),
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
      autoDownloadNextCount: normalizeAutoDownloadNextCount(loaded.autoDownloadNextCount),
      protectedDownloadJobIds: normalizeStringList(loaded.protectedDownloadJobIds),
      recoveryMode: normalizeRecoveryMode(loaded.recoveryMode),
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

  get artworkPreviewsEnabled(): boolean {
    return this.config.artworkPreviewsEnabled;
  }

  get offlineArtworkCacheEnabled(): boolean {
    return this.config.offlineArtworkCacheEnabled;
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
      ...(partial.protectedDownloadJobIds !== undefined
        ? { protectedDownloadJobIds: normalizeStringList(partial.protectedDownloadJobIds) }
        : null),
      ...(partial.recoveryMode !== undefined
        ? { recoveryMode: normalizeRecoveryMode(partial.recoveryMode) }
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
