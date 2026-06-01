// =============================================================================
// Config Store
//
// Low-level config persistence (file-based).
// =============================================================================

export type { KitsuneConfig } from "./ConfigService";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
} from "../download/StorageBudgetPolicy";
import type { KitsuneConfig } from "./ConfigService";

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
  reset(): Promise<void>;
}

// Default configuration
export const DEFAULT_CONFIG: KitsuneConfig = {
  defaultMode: "series",
  provider: "vidking",
  animeProvider: "allanime",
  subLang: "en",
  animeLang: "sub",
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "best" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
  animeTitlePreference: "english",
  headless: true,
  showMemory: false,
  autoNext: true,
  resumeStartChoicePrompt: true,
  skipRecap: false,
  skipIntro: true,
  skipPreview: false,
  skipCredits: true,
  footerHints: "detailed",
  quitNearEndBehavior: "continue",
  quitNearEndThresholdMode: "credits-or-90-percent",
  mpvKunaiScriptPath: "",
  mpvKunaiScriptOpts: {},
  mpvInProcessStreamReconnect: true,
  mpvInProcessStreamReconnectMaxAttempts: 1,
  discoverShowOnStartup: false,
  discoverMode: "auto",
  discoverItemLimit: 24,
  recommendationRailEnabled: true,
  minimalMode: false,
  zenMode: false,
  powerSaverMode: false,
  powerSaverAllowManualArtwork: true,
  presenceProvider: "off",
  presencePrivacy: "full",
  presenceDiscordClientId: "",
  presenceDiscordOpenUrl: "",
  downloadsEnabled: false,
  autoDownload: "off",
  autoDownloadNextCount: 1,
  autoCleanupWatched: false,
  recoveryMode: "guided",
  startupPriority: "balanced",
  artworkPreviewsEnabled: true,
  offlineArtworkCacheEnabled: true,
  offlineFreeSpaceReserveBytes: DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  offlineUnknownEpisodeEstimateBytes: DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
  offlineDefaultRunwayTarget: DEFAULT_OFFLINE_RUNWAY_TARGET,
  autoCleanupGraceDays: 7,
  protectedDownloadJobIds: [],
  onboardingVersion: 0,
  downloadPath: "",
  downloadOnboardingDismissed: false,
  updateChecksEnabled: true,
  updateCheckIntervalDays: 7,
  updateSnoozedUntil: 0,
  lastUpdateCheckAt: 0,
  lastUpdateCheckFailedAt: 0,
  lastKnownLatestVersion: "",
  sync: {
    anilist: { enabled: false, trackWatched: false, syncList: false },
    tmdb: { enabled: false, trackWatched: false, syncList: false },
  },
  syncNudgeDismissedAt: undefined,
  lastWeeklyDigestShownAt: null,
  tuningOverrides: {},
  titleProviderPreferences: {},
};
