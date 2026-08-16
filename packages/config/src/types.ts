import type { ProviderRelayConfig, StartupPriority } from "@kunai/types";

export type ContinueSourcePreference = "auto" | "local" | "stream" | "ask";

export type QuitNearEndBehavior = "continue" | "pause";

export type QuitNearEndThresholdMode = "credits-or-90-percent" | "percent-only" | "seconds-only";

export type PresenceProvider = "off" | "discord";

export type PresencePrivacy = "full" | "private";

/** Opt-in usage ping. Fresh installs stay `unset` and never send network traffic. */
export type AnalyticsPreference = "unset" | "enabled" | "disabled";
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

export interface YouTubeMetadataConfig {
  readonly instanceUrl?: string;
  readonly pipedApiUrl?: string;
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  /** Comma-separated SponsorBlock categories passed to yt-dlp on play/download (e.g. sponsor,intro). */
  readonly sponsorblockRemove?: string;
}

export interface KitsuneConfig {
  defaultMode: "series" | "anime" | "youtube";
  provider: string;
  animeProvider: string;
  youtubeProvider: string;
  providerPriority: readonly string[];
  animeProviderPriority: readonly string[];
  youtubeProviderPriority: readonly string[];
  youtubeLanguageProfile: MediaLanguageProfile;
  youtubeMetadata: YouTubeMetadataConfig;
  /** @deprecated use animeLanguageProfile/seriesLanguageProfile/movieLanguageProfile */
  subLang: string;
  /**
   * User-owned Wyzie API key for the external subtitle search
   * (https://store.wyzie.io/redeem). Empty by default and never shipped with a
   * value: the free tier is per-key rate limited, so a shared credential would
   * throttle everyone at once, and the key belongs to whoever redeemed it. With
   * no key the external lookup is skipped and only provider subtitles are used.
   */
  wyzieApiKey: string;
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
  /**
   * Playbacks that have shown the on-screen key card. It retires itself after a
   * few, so the keys are learnable without opening `?` or the docs, without
   * becoming permanent furniture for someone who already knows them.
   */
  playbackKeysSessionsSeen: number;
  /** Optional usage ping. Fresh installs are off until explicitly enabled. */
  analytics: AnalyticsPreference;
  /** Whether the one-time recommendation notice for an existing install was shown. */
  analyticsNoticeShown: boolean;
  /** Random UUID install id. Present if and only if `analytics === "enabled"`. */
  installId: string;
  /** Last successful cadence mark for the daily analytics ping (epoch ms). */
  lastAnalyticsPingAt: number;
  /**
   * Earliest epoch ms at which a failed analytics send may be retried.
   * `0` means no retry is pending. Set instead of `lastAnalyticsPingAt` when a
   * send fails, so the next CLI launch retries rather than losing the day.
   */
  analyticsRetryAfter: number;
  /** Optional operator-configured analytics ingest URL. Empty disables sending. */
  analyticsEndpoint: string;
  updateChecksEnabled: boolean;
  autoApplyBinaryUpdates: boolean;
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
