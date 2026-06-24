import type { ProviderRelayConfig, StartupPriority } from "@kunai/types";

export type ContinueSourcePreference = "auto" | "local" | "stream" | "ask";

export type QuitNearEndBehavior = "continue" | "pause";

export type QuitNearEndThresholdMode = "credits-or-90-percent" | "percent-only" | "seconds-only";

export type PresenceProvider = "off" | "discord";

export type PresencePrivacy = "full" | "private";
export type DiscoverMode = "auto" | "unified" | "anime-only" | "series-only";
export type AutoDownloadMode = "off" | "next" | "season";
export type RecoveryMode = "guided" | "fallback-first" | "manual";

/** Runtime tuning override bag; CLI tuning module resolves typed values. */
export type ConfigTuningOverrides = Partial<Record<string, number>>;

export interface MediaLanguageProfile {
  audio: string;
  subtitle: string;
  quality?: string;
}

export interface KitsuneConfig {
  defaultMode: "series" | "anime";
  provider: string;
  animeProvider: string;
  providerPriority: readonly string[];
  animeProviderPriority: readonly string[];
  /** @deprecated use animeLanguageProfile/seriesLanguageProfile/movieLanguageProfile */
  subLang: string;
  /** @deprecated use animeLanguageProfile/seriesLanguageProfile/movieLanguageProfile */
  animeLang: "sub" | "dub";
  animeLanguageProfile: MediaLanguageProfile;
  seriesLanguageProfile: MediaLanguageProfile;
  movieLanguageProfile: MediaLanguageProfile;
  animeTitlePreference: "english" | "romaji" | "native" | "provider";
  headless: boolean;
  showMemory: boolean;
  autoNext: boolean;
  autoplayRecommendations: boolean;
  favoriteSources: readonly string[];
  resumeStartChoicePrompt: boolean;
  discoverShowOnStartup: boolean;
  discoverMode: DiscoverMode;
  discoverItemLimit: number;
  recommendationRailEnabled: boolean;
  showWatchTimeStats: boolean;
  lastCalendarVisitAt: number;
  minimalMode: boolean;
  zenMode: boolean;
  powerSaverMode: boolean;
  powerSaverAllowManualArtwork: boolean;
  skipRecap: boolean;
  skipIntro: boolean;
  skipPreview: boolean;
  skipCredits: boolean;
  footerHints: "detailed" | "minimal";
  quitNearEndBehavior: QuitNearEndBehavior;
  continueSourcePreference: ContinueSourcePreference;
  quitNearEndThresholdMode: QuitNearEndThresholdMode;
  mpvKunaiScriptPath: string;
  mpvKunaiScriptOpts: Record<string, string>;
  mpvInProcessStreamReconnect: boolean;
  mpvInProcessStreamReconnectMaxAttempts: number;
  presenceProvider: PresenceProvider;
  presencePrivacy: PresencePrivacy;
  presenceDiscordClientId: string;
  presenceDiscordOpenUrl: string;
  videasySessionToken: string;
  providerRelay: ProviderRelayConfig;
  videasySessionExpiresAt: number;
  videasyAppId: "vidking" | "bc-frontend";
  downloadsEnabled: boolean;
  offlineMode: boolean;
  autoDownload: AutoDownloadMode;
  autoDownloadNextCount: number;
  maxConcurrentDownloads: number;
  defaultDownloadQuality: string;
  autoCleanupWatched: boolean;
  recoveryMode: RecoveryMode;
  startupPriority: StartupPriority;
  artworkPreviewsEnabled: boolean;
  offlineArtworkCacheEnabled: boolean;
  offlineFreeSpaceReserveBytes: number;
  offlineUnknownEpisodeEstimateBytes: number;
  offlineDefaultRunwayTarget: number;
  autoCleanupGraceDays: number;
  protectedDownloadJobIds: readonly string[];
  onboardingVersion: number;
  downloadPath: string;
  downloadOnboardingDismissed: boolean;
  updateChecksEnabled: boolean;
  autoApplyBinaryUpdates: boolean;
  updateChannel: "stable" | "latest";
  updateCheckIntervalDays: number;
  updateSnoozedUntil: number;
  lastUpdateCheckAt: number;
  lastUpdateCheckFailedAt: number;
  lastKnownLatestVersion: string;
  sync: {
    anilist: { enabled: boolean; trackWatched: boolean; syncList: boolean };
    tmdb: { enabled: boolean; trackWatched: boolean; syncList: boolean };
  };
  syncNudgeDismissedAt?: string;
  lastWeeklyDigestShownAt?: string | null;
  lastStreakMilestoneDays?: number;
  tuningOverrides?: ConfigTuningOverrides;
  titleProviderPreferences: Record<string, string>;
}
