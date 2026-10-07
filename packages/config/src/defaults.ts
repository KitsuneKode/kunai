import type { KitsuneConfig } from "./types";

export const DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES = 768 * 1024 * 1024;
export const DEFAULT_OFFLINE_RUNWAY_TARGET = 2;

/**
 * Ceiling on same-url mpv reloads per playback cycle — and, at 1, also the
 * shipped default.
 *
 * A dead stream answers a reload exactly as fast as a live one, so a budget
 * above 1 buys a retry loop against a URL that is not coming back rather than
 * recovery. One attempt covers the case worth covering: a transient network
 * read that a single reload resolves.
 *
 * This is the only place the number lives. `ConfigServiceImpl` clamps persisted
 * values to it, `PersistentMpvSession.create` clamps a raw config to it, and
 * `.docs/mpv-in-process-reconnect.md` documents it — those three disagreed
 * (1 / 3 / 12) until they were made to read from here.
 */
export const MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS = 1;

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
  // Series automatic lane (2026-09-27): VidLink leads. The videasy.to domain
  // has rotted — api.videasy.to (the provider's TMDB-mirror DB and legacy
  // endpoint host) no longer resolves at DNS, so title-metadata enrichment
  // depends on the mirror chain. The wings stream endpoints on
  // api.speedracelight.com answered CF 502 from 2026-09-21 and every player
  // host (player.videasy.to, cineby.at, cineplay.to) is unreachable — Videasy
  // stays registered and last in the order so an upstream revival needs no
  // code change.
  provider: "vidlink",
  // HiAnime leads the anime lane. AniDB stays registered and in the priority
  // tail because it still carries the only verified AID cross-link and XML
  // episode titles, but it is not first: anidb.app answers 503 at the origin,
  // and ani-cli itself moved off it (pystardust/ani-cli c99221d "replace anidb
  // with hianime provider", a `fix:`, not a `revert:`). A lane default that
  // cannot answer is worse than a slower one that can — search only queries
  // the configured default.
  animeProvider: "hianime",
  youtubeProvider: "youtube",
  // `createProviderPrioritySnapshot` prepends `provider` to this array, so it
  // holds the *rest* of the order — not the lane default. Rivestream leads the
  // rest (eleven-service local cycle behind the shared resolve gate, so one
  // dead mirror costs a candidate, not the lane); VidRock follows (multi-lane
  // AES-GCM payloads behind the direct-stream gate). Videasy is named
  // explicitly to pin it last rather than float among unlisted providers: its
  // session/turnstile path and rotted `videasy.to` domain make it the
  // fallback, not the lead — registered, not removed.
  providerPriority: ["rivestream", "vidrock", "videasy"],
  // Ordering, not an allowlist: every registered anime module stays reachable.
  // `createProviderPrioritySnapshot` prepends `animeProvider`, so this array
  // holds the *rest* of the order and must not repeat the lane default. Miruro
  // is first of the rest: it aggregates roughly a dozen backends behind one
  // AniList-keyed pipe, so one upstream going dark costs a server rather than
  // the lane. KickAssAnime and AnimeGG share nothing with Miruro — own
  // catalog, own site, own CDN — and KickAssAnime can take over a title Miruro
  // found. AniDB follows for when it returns, then AllAnime for the ani-cli
  // parity path.
  animeProviderPriority: ["miruro", "kickassanime", "animegg", "anidb", "allanime"],
  // Bump alongside any lane-default change above; see `providerDefaultsRevision`.
  // Revision 3 leads with VidLink + HiAnime and covers both lanes.
  providerDefaultsRevision: 3,
  youtubeProviderPriority: ["youtube"],
  youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
  youtubeMetadata: { extractorArgs: DEFAULT_YOUTUBE_EXTRACTOR_ARGS },
  wyzieApiKey: "",
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "best" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
  animeTitlePreference: "english",
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
  companionPet: "auto",
  quitNearEndBehavior: "continue",
  continueSourcePreference: "auto",
  quitNearEndThresholdMode: "credits-or-90-percent",
  mpvKunaiScriptPath: "",
  mpvKunaiScriptOpts: {},
  mpvInProcessStreamReconnect: true,
  mpvInProcessStreamReconnectMaxAttempts: MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS,
  discoverShowOnStartup: false,
  discoverMode: "auto",
  discoverItemLimit: 24,
  recommendationRailEnabled: true,
  showWatchTimeStats: true,
  lastCalendarVisitAt: 0,
  minimalMode: false,
  zenMode: false,
  powerSaverMode: false,
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
  maxConcurrentDownloads: 3,
  defaultDownloadQuality: "best",
  autoCleanupWatched: false,
  recoveryMode: "guided",
  startupPriority: "balanced",
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
