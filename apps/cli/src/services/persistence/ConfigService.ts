// =============================================================================
// Config Service
//
// Manages user configuration and preferences.
// =============================================================================

export type QuitNearEndBehavior = "continue" | "pause";

export type QuitNearEndThresholdMode = "credits-or-90-percent" | "percent-only" | "seconds-only";

export type PresenceProvider = "off" | "discord";

export type PresencePrivacy = "full" | "private";
export type DiscoverMode = "auto" | "unified" | "anime-only" | "series-only";
export type AutoDownloadMode = "off" | "next" | "season";
export type RecoveryMode = "guided" | "fallback-first" | "manual";

export interface MediaLanguageProfile {
  audio: string;
  subtitle: string;
  quality?: string;
}

export interface KitsuneConfig {
  defaultMode: "series" | "anime";
  provider: string;
  animeProvider: string;
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
  /**
   * When true (default), persistent autoplay with a positive resume offset shows an mpv overlay
   * to choose resume vs start over before seeking.
   */
  resumeStartChoicePrompt: boolean;
  /** Show a faint "/ recommendation" hint in the browse footer when history is non-empty. Default false. */
  discoverShowOnStartup: boolean;
  /** Discover result mode policy. auto = follow current shell mode. */
  discoverMode: DiscoverMode;
  /** Max number of discover results shown in browse shell. */
  discoverItemLimit: number;
  /** Show compact recommendation rail after playback completion. Default true. */
  recommendationRailEnabled: boolean;
  /** Collapse companion pane, minimal footer, and dim header status regardless of terminal size. Default false. */
  minimalMode: boolean;
  /** Suppress optional background network and speculative work while preserving manual actions. */
  powerSaverMode: boolean;
  /** Permit explicitly requested artwork work while Power Saver is enabled. */
  powerSaverAllowManualArtwork: boolean;
  skipRecap: boolean;
  skipIntro: boolean;
  skipPreview: boolean;
  skipCredits: boolean;
  footerHints: "detailed" | "minimal";
  /** When user quits mpv near the natural end, whether auto-next may still advance. */
  quitNearEndBehavior: QuitNearEndBehavior;
  /** How “near the end” is detected for quit + completion thresholds. */
  quitNearEndThresholdMode: QuitNearEndThresholdMode;
  /**
   * Absolute path to the Kunai mpv bridge Lua script. Empty string = auto-resolve to
   * `getKunaiPaths().mpvBridgePath` (platform Kunai config dir + `mpv/kunai-bridge.lua`) or bundled copy.
   */
  mpvKunaiScriptPath: string;
  /**
   * mpv `--script-opts` entries for the `kunai-bridge` script (e.g. margin_bottom=130).
   * Merged with built-in defaults in the script via mp.read_options.
   */
  mpvKunaiScriptOpts: Record<string, string>;
  /**
   * Persistent mpv: after a `network-read-dead` stall, reload the same stream URL over IPC
   * (optional seek for VOD). Disable to rely only on manual refresh / provider re-resolve.
   */
  mpvInProcessStreamReconnect: boolean;
  /** Max same-URL reload attempts per playback cycle; `0` disables in-process reconnect. */
  mpvInProcessStreamReconnectMaxAttempts: number;
  /** Optional local-first social presence integration. Default off. */
  presenceProvider: PresenceProvider;
  /** How much title/episode detail presence integrations may expose. */
  presencePrivacy: PresencePrivacy;
  /** Discord application client id. Empty string = read KUNAI_DISCORD_CLIENT_ID when needed. */
  presenceDiscordClientId: string;
  /** Reserved safe HTTPS or kunai:// handoff URL for future Discord buttons. */
  presenceDiscordOpenUrl: string;
  /** Optional offline download feature gate. Default off until the user opts in. */
  downloadsEnabled: boolean;
  /**
   * Legacy streaming auto-download preference. Non-off stored values normalize to off;
   * automatic downloads require explicit per-title offline-continuation enrollment.
   */
  autoDownload: AutoDownloadMode;
  /** Legacy bounded batch preference retained for config compatibility only. */
  autoDownloadNextCount: number;
  /** Surface completed watched downloads as cleanup candidates after the grace period. Default false. */
  autoCleanupWatched: boolean;
  /** Playback/provider recovery behavior. Default guided. */
  recoveryMode: RecoveryMode;
  /** Render/fetch artwork previews when terminal capability allows it. Default true. */
  artworkPreviewsEnabled: boolean;
  /** Best-effort cache poster artwork for downloaded entries. Default true. */
  offlineArtworkCacheEnabled: boolean;
  /** Bytes reserved on the download volume before accepting additional offline media. */
  offlineFreeSpaceReserveBytes: number;
  /** Conservative byte estimate used when an episode size is unknown before download. */
  offlineUnknownEpisodeEstimateBytes: number;
  /** Default future local episode target offered when enrolling a title. */
  offlineDefaultRunwayTarget: number;
  /** Days to keep watched downloads before startup cleanup may suggest them. */
  autoCleanupGraceDays: number;
  /** Completed download job ids protected from watched-download cleanup suggestions. */
  protectedDownloadJobIds: readonly string[];
  /** Setup wizard completion marker for future migrations. */
  onboardingVersion: number;
  /** Directory for offline downloads. Empty string = use Kunai app data defaults when implemented. */
  downloadPath: string;
  /** Suppress the first-run offline/download onboarding reminder. */
  downloadOnboardingDismissed: boolean;
  /** Optional background update checks. Never runs package-manager commands. */
  updateChecksEnabled: boolean;
  /** Minimum days between automatic update checks. */
  updateCheckIntervalDays: number;
  /** Epoch ms until which update notices are muted. 0 means not snoozed. */
  updateSnoozedUntil: number;
  /** Epoch ms of the last attempted update check. 0 means never. */
  lastUpdateCheckAt: number;
  /** Epoch ms of the last failed update check. 0 means no recorded failure. */
  lastUpdateCheckFailedAt: number;
  /** Last latest version observed from the update source. Empty string means unknown. */
  lastKnownLatestVersion: string;
  /** Per-provider sync settings. Tokens stored separately in sync-tokens.json. */
  sync: {
    anilist: { enabled: boolean; trackWatched: boolean; syncList: boolean };
    tmdb: { enabled: boolean; trackWatched: boolean; syncList: boolean };
  };
  /** ISO timestamp of when the one-time sync nudge was dismissed. Undefined = not yet shown. */
  syncNudgeDismissedAt?: string;
  /** ISO timestamp of when the weekly digest was last shown. Null = never. */
  lastWeeklyDigestShownAt?: string | null;
  /** The highest streak milestone (in days) that has already been celebrated. */
  lastStreakMilestoneDays?: number;
}

export interface ConfigService extends KitsuneConfig {
  // Raw config access
  getRaw(): KitsuneConfig;
  update(partial: Partial<KitsuneConfig>): Promise<void>;
  save(): Promise<void>;
  reset(): Promise<void>;
}

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
}
