import type { KitsuneConfig } from "./types";

export const DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES = 768 * 1024 * 1024;
export const DEFAULT_OFFLINE_RUNWAY_TARGET = 2;

/**
 * yt-dlp player clients Kunai asks for by default.
 *
 * This mirrors yt-dlp's own unauthenticated default (`_DEFAULT_CLIENTS` in
 * `yt_dlp/extractor/youtube/_video.py`), and the order is the whole point.
 * `visionos` is the only client with no GVS PO-token policy, so its formats are
 * always usable; `web` declares `required=True` for HTTPS and DASH, and yt-dlp
 * *skips* formats whose PO token is missing rather than trying them. Kunai turns
 * each client into its own failover lane, so leading with a token-gated client
 * spends a whole lane on formats that were never going to be offered.
 *
 * This is a default, not a pin — Settings › YouTube › extractor args overrides it,
 * and it should be revisited whenever yt-dlp's own client order changes.
 */
export const DEFAULT_YOUTUBE_EXTRACTOR_ARGS = "youtube:player_client=visionos,web";

export const DEFAULT_CONFIG: KitsuneConfig = {
  defaultMode: "series",
  // Series automatic lane (2026-07-16): Videasy first (fast seed+neon path), then Rivestream, VidLink.
  provider: "videasy",
  // Miruro leads the anime lane (2026-09-11). It aggregates roughly a dozen
  // backends behind one AniList-keyed pipe, so one upstream going dark costs a
  // server rather than the lane — whereas anidb.app, which ani-cli v5 depends on
  // alone, has been in maintenance since 2026-09-03. It searches through its own
  // pipe, which kept answering when AniList's API was disabled on 2026-09-10.
  animeProvider: "miruro",
  youtubeProvider: "youtube",
  providerPriority: ["rivestream", "vidlink"],
  // Ordering, not an allowlist: every registered anime module stays reachable.
  // KickAssAnime and AnimeGG share nothing with Miruro — own catalog, own site,
  // own CDN — so a Miruro outage does not take them too. Both take over a title
  // Miruro found by matching its name; KickAssAnime is first because its match
  // also checks the year (AnimeGG's search exposes none, so a sequel is likelier
  // to be refused as ambiguous) and it carries real subtitle tracks.
  // AniDB follows for when it returns, then AllAnime for the ani-cli parity path.
  animeProviderPriority: ["miruro", "kickassanime", "animegg", "anidb", "allanime"],
  // Bump alongside any lane-default change above; see `providerDefaultsRevision`.
  providerDefaultsRevision: 1,
  youtubeProviderPriority: ["youtube"],
  youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
  youtubeMetadata: { extractorArgs: DEFAULT_YOUTUBE_EXTRACTOR_ARGS },
  subLang: "en",
  wyzieApiKey: "",
  animeLang: "sub",
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "best" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
  animeTitlePreference: "english",
  headless: true,
  showMemory: false,
  autoNext: true,
  autoplayRecommendations: true,
  favoriteSources: [],
  resumeStartChoicePrompt: true,
  skipRecap: false,
  skipIntro: true,
  skipPreview: false,
  skipCredits: true,
  footerHints: "detailed",
  quitNearEndBehavior: "continue",
  continueSourcePreference: "auto",
  quitNearEndThresholdMode: "credits-or-90-percent",
  mpvKunaiScriptPath: "",
  mpvKunaiScriptOpts: {},
  mpvInProcessStreamReconnect: true,
  mpvInProcessStreamReconnectMaxAttempts: 1,
  discoverShowOnStartup: false,
  discoverMode: "auto",
  discoverItemLimit: 24,
  recommendationRailEnabled: true,
  showWatchTimeStats: true,
  lastCalendarVisitAt: 0,
  minimalMode: false,
  zenMode: false,
  powerSaverMode: false,
  powerSaverAllowManualArtwork: true,
  presenceProvider: "off",
  presencePrivacy: "full",
  presenceDiscordClientId: "",
  presenceDiscordOpenUrl: "",
  videasySessionToken: "",
  providerRelay: {
    enabled: true,
    baseUrl: "",
    token: "",
    fallbackToDirect: true,
    providers: {},
  },
  videasySessionExpiresAt: 0,
  videasyAppId: "bc-frontend",
  downloadsEnabled: false,
  offlineMode: false,
  autoDownload: "off",
  autoDownloadNextCount: 1,
  maxConcurrentDownloads: 3,
  defaultDownloadQuality: "best",
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
  playbackKeysSessionsSeen: 0,
  analytics: "unset",
  analyticsNoticeShown: false,
  installId: "",
  lastAnalyticsPingAt: 0,
  analyticsRetryAfter: 0,
  analyticsEndpoint: "",
  updateChecksEnabled: true,
  autoApplyBinaryUpdates: true,
  updateCheckIntervalDays: 7,
  updateSnoozedUntil: 0,
  lastUpdateCheckAt: 0,
  lastUpdateCheckFailedAt: 0,
  lastKnownLatestVersion: "",
  sync: {
    pausedUntil: null,
    anilist: { enabled: false, trackWatched: false, syncList: false },
    tmdb: { enabled: false, trackWatched: false, syncList: false },
  },
  lastWeeklyDigestShownAt: null,
  tuningOverrides: {},
  titleProviderPreferences: {},
};
