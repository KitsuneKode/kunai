import type { ProviderRelayConfig, StartupPriority } from "@kunai/types";

export type ContinueSourcePreference = "auto" | "local" | "stream" | "ask";

/**
 * Whether playback pauses on the Tracks sheet before mpv launches.
 * `"off"` auto-plays the resolved pick; `"when-choices"` prompts only when the
 * inventory has a real source/quality/track choice; `"always"` prompts on
 * every inventory. Applies to user-launched plays — autoplay advances and
 * restarts never re-prompt.
 */
export type PrePlayConfirmMode = "off" | "when-choices" | "always";

export type QuitNearEndBehavior = "continue" | "pause";

export type QuitNearEndThresholdMode = "credits-or-90-percent" | "percent-only" | "seconds-only";

export type PresenceProvider = "off" | "discord";

export type PresencePrivacy = "full" | "private";

/** Opt-in usage ping. Fresh installs stay `unset` and never send network traffic. */
export type AnalyticsPreference = "unset" | "enabled" | "disabled";
export type DiscoverMode = "auto" | "unified" | "anime-only" | "series-only";
export type RecoveryMode = "guided" | "fallback-first" | "manual";
/** Single source of truth for HDR modes: config, settings, `--hdr`, completion, capabilities. */
export const HDR_MODES = ["auto", "passthrough", "tone-map", "sdr-only"] as const;
export type HdrMode = (typeof HDR_MODES)[number];

export function isHdrMode(value: unknown): value is HdrMode {
  return typeof value === "string" && (HDR_MODES as readonly string[]).includes(value);
}

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
  /** Proof of Origin (PO) token passed to yt-dlp to unlock DASH streams. */
  readonly poToken?: string;
  /** Comma-separated SponsorBlock categories passed to yt-dlp on play/download (e.g. sponsor,intro). */
  readonly sponsorblockRemove?: string;
}

/** One Stremio addon the user added. */
export interface StremioAddonConfigEntry {
  /**
   * The addon's `https://…/manifest.json` address. Treat it as a secret: a
   * configured addon carries the user's own settings, and sometimes an account
   * token, in the path. Show the host; never log or export the whole value.
   */
  readonly url: string;
  /** The addon's own name, recorded from its manifest. Display only. */
  readonly name?: string;
}

export interface KitsuneConfig {
  defaultMode: "series" | "anime" | "youtube";
  provider: string;
  animeProvider: string;
  youtubeProvider: string;
  providerPriority: readonly string[];
  animeProviderPriority: readonly string[];
  youtubeProviderPriority: readonly string[];
  /**
   * Provider ids the user switched off. Order-only everywhere else: priority
   * lists sort, this list filters. Empty by default. Disabling an entire lane
   * leaves it empty until the user explicitly re-enables a provider.
   */
  disabledProviders: readonly string[];
  /**
   * Stremio addons the user added, as movie and series sources. Empty by
   * default and never shipped with an entry: Kunai bundles no addon. Each one
   * becomes a provider whose id is derived from its URL, so it is ordered and
   * switched off through `providerPriority` and `disabledProviders` like any
   * other. Read once at startup; a removal is honoured immediately.
   */
  stremioAddons: readonly StremioAddonConfigEntry[];
  /**
   * Experimental Stremio addons opt-in. Strict `true` is the only on value —
   * anything else is off. Alone it changes nothing: addon provider modules are
   * installed only while this is `true` AND `stremioAddonsRiskAcknowledgedAt`
   * holds a valid ISO timestamp. Disabling stops addon requests at the next
   * resolve; the installed list and the acknowledgement are kept so a
   * re-enable does not re-ask consent.
   */
  experimentalStremioAddons: boolean;
  /**
   * ISO-8601 instant (the `new Date().toISOString()` shape) at which the user
   * acknowledged the Stremio addon risk warning. Empty means never
   * acknowledged; a non-ISO or otherwise invalid value normalizes to empty,
   * which is also off.
   */
  stremioAddonsRiskAcknowledgedAt: string;
  /**
   * Which revision of the shipped provider defaults this config has been
   * reconciled against. The whole merged config is written on every save, so an
   * old default sits on disk looking exactly like a choice; bumping this when a
   * lane default changes lets load migrate that inherited value once, and then
   * never again — so a user who picks the old provider back keeps it.
   *
   * Absent means "saved before revisions existed". 1 = anime lane moved from
   * AniDB to Miruro (2026-09-11). 2 = unused intermediate revision.
   * 3 = anime lane moved to HiAnime, Miruro second, KickAssAnime and AnimeGG
   * behind it (2026-09-30). 6 = AniDB retired from production and dropped from
   * shipped anime defaults (2026-10-24). A bump needs the previous default added
   * to `INHERITED_ANIME_DEFAULTS` in ConfigServiceImpl, or it migrates nobody.
   */
  providerDefaultsRevision?: number;
  youtubeLanguageProfile: MediaLanguageProfile;
  youtubeMetadata: YouTubeMetadataConfig;
  /**
   * User-owned Wyzie API key for the external subtitle search
   * (https://store.wyzie.io/redeem). Empty by default and never shipped with a
   * value: the free tier is per-key rate limited, so a shared credential would
   * throttle everyone at once, and the key belongs to whoever redeemed it. With
   * no key the external lookup is skipped and only provider subtitles are used.
   */
  wyzieApiKey: string;
  /**
   * The user's own TMDB credential: a v3 API key or a v4 read access token.
   * Empty uses Kunai's release key, then keyless mirrors.
   */
  tmdbApiKey: string;
  animeLanguageProfile: MediaLanguageProfile;
  seriesLanguageProfile: MediaLanguageProfile;
  movieLanguageProfile: MediaLanguageProfile;
  animeTitlePreference: "english" | "romaji" | "native" | "provider";
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
  /**
   * Plain / screen-reader mode: disables animations, decorative glyphs, box
   * borders, and image art, renders linear single-column output, and announces
   * state and selection in explicit words. Overridable per run with `--plain`
   * or `KUNAI_PLAIN=1`.
   */
  plainMode: boolean;
  powerSaverMode: boolean;
  skipRecap: boolean;
  skipIntro: boolean;
  skipPreview: boolean;
  skipCredits: boolean;
  footerHints: "detailed" | "minimal";
  /**
   * Kanna, the companion fox, on empty/error surfaces and the exit screen.
   * "auto" resolves from env and terminal capability; "off" hides her until
   * `/pet` or this setting brings her back. `KUNAI_PET=off` still wins — an
   * automation off cannot be overridden from inside the app.
   */
  companionPet: "auto" | "off";
  /**
   * Shell theme id from `@kunai/design`'s `THEMES` registry (e.g.
   * `"ember-dusk"`, `"nord"`). A string, not a union: `@kunai/config` may not
   * depend on `@kunai/design` (boundary allowlist), so the registry validates
   * at apply time and an unrecognized value falls back to the brand default.
   */
  theme: string;
  quitNearEndBehavior: QuitNearEndBehavior;
  continueSourcePreference: ContinueSourcePreference;
  prePlayConfirm: PrePlayConfirmMode;
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
  maxConcurrentDownloads: number;
  defaultDownloadQuality: string;
  autoCleanupWatched: boolean;
  recoveryMode: RecoveryMode;
  startupPriority: StartupPriority;
  hdrMode: HdrMode;
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
  /**
   * Whether the one-line contextual shortcut hints may appear at all. Disabling
   * is the way out of the feature entirely — the seen set is kept so turning
   * tips back on does not re-teach what was already shown.
   */
  tipsEnabled: boolean;
  /**
   * Ids of every contextual tip that has already rendered. A tip is once-ever:
   * once its id lands here it never displays again, including across restarts.
   */
  seenTips: readonly string[];
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
    /**
     * A timed pause across every tracker, distinct from turning one off.
     *
     * `enabled: false` means "never"; this means "not right now". Work keeps
     * queueing while paused and is delivered on resume, so pausing never costs
     * the user an episode. ISO-8601, or null/absent when not paused.
     */
    pausedUntil?: string | null;
    anilist: { enabled: boolean; trackWatched: boolean; syncList: boolean };
    tmdb: { enabled: boolean; trackWatched: boolean; syncList: boolean };
  };
  lastWeeklyDigestShownAt?: string | null;
  lastStreakMilestoneDays?: number;
  tuningOverrides?: ConfigTuningOverrides;
  titleProviderPreferences: Record<string, string>;
}
