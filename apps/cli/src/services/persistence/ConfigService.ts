// =============================================================================
// Config Service
//
// Manages user configuration and preferences.
// =============================================================================

export type QuitNearEndBehavior = "continue" | "pause";

export type QuitNearEndThresholdMode = "credits-or-90-percent" | "percent-only" | "seconds-only";

export interface KitsuneConfig {
  defaultMode: "series" | "anime";
  provider: string;
  animeProvider: string;
  subLang: string;
  animeLang: "sub" | "dub";
  animeTitlePreference: "english" | "romaji" | "native" | "provider";
  headless: boolean;
  showMemory: boolean;
  autoNext: boolean;
  /**
   * When true (default), persistent autoplay with a positive resume offset shows an mpv overlay
   * to choose resume vs start over before seeking.
   */
  resumeStartChoicePrompt: boolean;
  /** Show a faint "/ discover" hint in the browse footer when history is non-empty. Default false. */
  discoverShowOnStartup: boolean;
  /** Collapse companion pane, minimal footer, and dim header status regardless of terminal size. Default false. */
  minimalMode: boolean;
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
