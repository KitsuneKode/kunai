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
  // HiAnime leads the anime lane. AniDB was removed from the production roster
  // when anidb.app began redirecting to an unrelated site (HTTP 302 to
  // anilab.so, 2026-10-24); ani-cli had already moved to HiAnime (c99221d).
  // The package remains for fixtures and historic ids — not live resolve.
  animeProvider: "hianime",
  youtubeProvider: "youtube",
  // `createProviderPrioritySnapshot` prepends `provider` to this array, so it
  // holds the *rest* of the order — not the lane default. Rivestream leads the
  // rest (eleven-service local cycle behind the shared resolve gate, so one
  // dead mirror costs a candidate, not the lane); VidRock follows (multi-lane
  // AES-GCM payloads behind the direct-stream gate). Movy is named explicitly
  // ahead of Videasy: unlisted it floated to the very end, behind a provider
  // whose upstream is gone, while its own aggregator still resolves. Videasy
  // stays named and last rather than floating: its session/turnstile path and
  // rotted `videasy.to` domain make it the fallback, not the lead — registered,
  // not removed.
  providerPriority: ["rivestream", "vidrock", "movy", "videasy"],
  // Ordering, not an allowlist: every registered anime module stays reachable.
  // `createProviderPrioritySnapshot` prepends `animeProvider`, so this array
  // holds the *rest* of the order and must not repeat the lane default.
  // KickAssAnime leads the rest (own catalog, own site, own CDN, soft VTT
  // subs); AnimeGG follows (multi-rung MP4, hardsubbed). AllAnime precedes
  // Miruro at the tail — its `/api/secure/pipe` route is gone from their
  // shipped bundle (2026-10-13) but the module stays registered for revival.
  animeProviderPriority: ["kickassanime", "animegg", "allanime", "miruro"],
  // Bump alongside any lane-default change above; see `providerDefaultsRevision`.
  // Revision 3 leads with VidLink + HiAnime and covers both lanes.
  // Revision 4 reorders dead/degraded tails: Movy is named before Videasy in
  // the series lane and AllAnime precedes AniDB in the anime lane.
  // Revision 5 demoted Miruro and AniDB behind AllAnime while both stayed live.
  // Revision 6 retires AniDB from production and drops it from shipped defaults.
  providerDefaultsRevision: 6,
  disabledProviders: [],
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
  // `DEFAULT_THEME_NAME` in `@kunai/design`, duplicated as a literal: config
  // cannot import design (boundary allowlist). Ember Dusk stays the default.
  theme: "ember-dusk",
  quitNearEndBehavior: "continue",
  continueSourcePreference: "auto",
  prePlayConfirm: "off",
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
  tipsEnabled: true,
  seenTips: [],
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
