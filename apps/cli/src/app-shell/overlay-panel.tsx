import { getConfigMetadata } from "@/services/persistence/config-metadata";
import type {
  AutoDownloadMode,
  DiscoverMode,
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
} from "@/services/persistence/ConfigService";
import type { PresenceSnapshot } from "@/services/presence/PresenceService";
import { resolvePresenceClientIdSource } from "@/services/presence/PresenceServiceImpl";
import type { StartupPriority } from "@kunai/types";
import { Box, Text } from "ink";
import React from "react";

import { PickerOptionRow } from "./overlay-picker-row";
import { renderHistoryProgressBar } from "./panel-data";
import { PosterInitialBlock } from "./poster-initial-block";
import type { PosterResult, PosterState } from "./poster-types";
import { BooleanSwitch } from "./primitives/Switch";
import { getWindowStart, truncateAtWord, truncateLine, wrapText } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { ShellPanelLine, ShellPickerOption } from "./types";
import { usePosterPreview } from "./use-poster-preview";

export { formatPickerDisplayRow, formatPickerOptionRow } from "./overlay-picker-row";

const BUSY_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function useBusySpinner(active: boolean): string {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % BUSY_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [active]);
  return BUSY_FRAMES[frame] ?? "⠋";
}

export type BrowseOverlay =
  | {
      type: "help" | "about" | "diagnostics" | "history" | "details";
      title: string;
      subtitle: string;
      lines: readonly ShellPanelLine[];
      imageUrl?: string;
      loading?: boolean;
      scrollIndex?: number;
    }
  | {
      type: "provider" | "history-picker";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      busy?: boolean;
      filterMode?: "all" | "watching" | "completed";
    }
  | {
      type: "settings";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      dirty: boolean;
      busy?: boolean;
    }
  | {
      type: "settings-choice";
      title: string;
      subtitle: string;
      setting: SettingsChoiceValue;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      parentSelectedIndex?: number;
      busy?: boolean;
    }
  | {
      type: "episode-picker";
      title: string;
      subtitle: string;
      options: readonly ShellPickerOption<string>[];
      filterQuery: string;
      selectedIndex: number;
      busy?: boolean;
    };

export function getOverlayPickerPreviewImageUrl(overlay: BrowseOverlay): string | undefined {
  if (overlay.type !== "episode-picker") return undefined;
  return overlay.options[overlay.selectedIndex]?.previewImageUrl;
}

type SettingsAction =
  | `section:${string}`
  | "defaultMode"
  | "provider"
  | "animeProvider"
  | "animeAudio"
  | "animeSubtitle"
  | "seriesAudio"
  | "seriesSubtitle"
  | "movieAudio"
  | "movieSubtitle"
  | "animeTitlePreference"
  | "showMemory"
  | "autoNext"
  | "autoDownload"
  | "recoveryMode"
  | "startupPriority"
  | "autoCleanupWatched"
  | "resumeStartChoicePrompt"
  | "quitNearEndBehavior"
  | "quitNearEndThresholdMode"
  | "skipRecap"
  | "skipIntro"
  | "skipCredits"
  | "skipPreview"
  | "footerHints"
  | "discoverShowOnStartup"
  | "discoverMode"
  | "discoverItemLimit"
  | "recommendationRailEnabled"
  | "presenceProvider"
  | "presencePrivacy"
  | "presenceStatus"
  | "presenceDiscordClientId"
  | "presenceDiscordOpenUrl"
  | "videasySessionToken"
  | "videasyAppId"
  | "presenceConnection"
  | "downloadsEnabled"
  | "powerSaverMode"
  | "autoDownloadNextCount"
  | "autoCleanupGraceDays"
  | "downloadPath"
  | "clearCache"
  | "clearHistory";

export type SettingsChoiceValue = SettingsAction;

const SUBTITLE_SETTINGS_OPTIONS: readonly ShellPickerOption<string>[] = [
  { value: "en", label: "English" },
  { value: "interactive", label: "Pick interactively" },
  { value: "none", label: "None" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
];

const AUDIO_SETTINGS_OPTIONS: readonly ShellPickerOption<string>[] = [
  { value: "original", label: "Original", detail: "Prefer original/native audio" },
  { value: "en", label: "English", detail: "Prefer English audio when available" },
  { value: "ja", label: "Japanese", detail: "Prefer Japanese audio when available" },
  { value: "dub", label: "Dub", detail: "Prefer dubbed audio when available" },
];

const ANIME_TITLE_SETTINGS_OPTIONS: readonly ShellPickerOption<
  KitsuneConfig["animeTitlePreference"]
>[] = [
  { value: "english", label: "English", detail: "Prefer localized English titles when known" },
  { value: "romaji", label: "Romaji", detail: "Prefer romanized Japanese titles" },
  { value: "native", label: "Native", detail: "Prefer native Japanese titles" },
  { value: "provider", label: "Provider", detail: "Use the title returned by the active provider" },
];

const QUIT_NEAR_END_BEHAVIOR_OPTIONS: readonly ShellPickerOption<QuitNearEndBehavior>[] = [
  {
    value: "continue",
    label: "Continue",
    detail: "Quitting mpv near the end still allows auto-next when enabled",
  },
  {
    value: "pause",
    label: "Pause chain",
    detail: "Quitting mpv always stops the auto-next chain (EOF still advances)",
  },
];

const QUIT_THRESHOLD_MODE_OPTIONS: readonly ShellPickerOption<QuitNearEndThresholdMode>[] = [
  {
    value: "credits-or-90-percent",
    label: "Credits or last 5s",
    detail: "Prefer AniSkip/IntroDB credits start, else last five seconds",
  },
  {
    value: "percent-only",
    label: "95% watched",
    detail: "Treat as near-end when watched ≥ 95% of reported duration",
  },
  {
    value: "seconds-only",
    label: "Last 5 seconds",
    detail: "Ignore segment timing; only last five seconds count as near-end",
  },
];

const FOOTER_HINT_OPTIONS: readonly ShellPickerOption<"detailed" | "minimal">[] = [
  {
    value: "detailed",
    label: "Detailed",
    detail: "Current task plus a second line of active shortcuts",
  },
  {
    value: "minimal",
    label: "Minimal",
    detail: "Keep the task visible and trim the shortcut strip down",
  },
];

const DISCOVER_MODE_OPTIONS: readonly ShellPickerOption<DiscoverMode>[] = [
  {
    value: "auto",
    label: "Auto",
    detail: "Follow the current shell mode when building discovery lists",
  },
  {
    value: "unified",
    label: "Unified",
    detail: "Mix anime and series when both catalogs are available",
  },
  {
    value: "anime-only",
    label: "Anime only",
    detail: "Keep discovery and surprise focused on anime",
  },
  {
    value: "series-only",
    label: "Series only",
    detail: "Keep discovery and surprise focused on shows and movies",
  },
];

const DISCOVER_ITEM_LIMIT_OPTIONS: readonly ShellPickerOption<string>[] = [12, 24, 36, 48, 80].map(
  (count) => ({
    value: String(count),
    label: `${count} items`,
    detail: count <= 24 ? "Lean tray with quicker scanning" : "Bigger tray for browsing sessions",
  }),
);

const AUTO_DOWNLOAD_NEXT_COUNT_OPTIONS: readonly ShellPickerOption<string>[] = [
  1, 2, 3, 6, 12, 24,
].map((count) => ({
  value: String(count),
  label: count === 1 ? "1 episode" : `${count} episodes`,
  detail:
    count === 1
      ? "Only keep the immediate next episode queued"
      : `Keep the next ${count} released episodes queued when Auto-download is Next`,
}));

const AUTO_CLEANUP_GRACE_DAY_OPTIONS: readonly ShellPickerOption<string>[] = [
  0, 1, 3, 7, 14, 30,
].map((days) => ({
  value: String(days),
  label: days === 0 ? "Immediately" : days === 1 ? "1 day" : `${days} days`,
  detail:
    days === 0
      ? "Show watched downloads as cleanup candidates immediately"
      : `Wait ${days} day${days === 1 ? "" : "s"} after watch completion`,
}));

const RECOVERY_MODE_OPTIONS: readonly ShellPickerOption<KitsuneConfig["recoveryMode"]>[] = [
  {
    value: "guided",
    label: "Balanced recovery",
    detail: "Retry once, then recover when the issue is clear.",
  },
  {
    value: "fallback-first",
    label: "Fast fallback",
    detail: "Switch providers faster after slow or failed resolves.",
  },
  {
    value: "manual",
    label: "Ask before switching",
    detail: "Never switch providers without asking.",
  },
];

const STARTUP_PRIORITY_OPTIONS: readonly ShellPickerOption<StartupPriority>[] = [
  {
    value: "balanced",
    label: "Balanced",
    detail: "Prefer ready 1080p playback without a long wait.",
  },
  { value: "fast", label: "Fast", detail: "Start the first healthy playable source." },
  {
    value: "quality-first",
    label: "Quality first",
    detail: "Wait longer for stronger quality choices.",
  },
];

const PRESENCE_PROVIDER_OPTIONS: readonly ShellPickerOption<KitsuneConfig["presenceProvider"]>[] = [
  {
    value: "off",
    label: "Off",
    detail: "Do not publish local playback state anywhere",
  },
  {
    value: "discord",
    label: "Discord",
    detail: "Use optional local Discord Rich Presence through Discord desktop IPC",
  },
];

const PRESENCE_PRIVACY_OPTIONS: readonly ShellPickerOption<KitsuneConfig["presencePrivacy"]>[] = [
  {
    value: "full",
    label: "Full",
    detail: "Show title and episode in supported presence integrations",
  },
  {
    value: "private",
    label: "Private",
    detail: "Show only that Kunai playback is active",
  },
];

const AUTO_DOWNLOAD_OPTIONS: readonly ShellPickerOption<AutoDownloadMode>[] = [
  { value: "off", label: "Off", detail: "Never queue future episodes automatically" },
  {
    value: "next",
    label: "Next episode",
    detail: "Queue the next available episode after playback",
  },
  {
    value: "season",
    label: "Rest of season",
    detail: "Queue remaining unwatched episodes in the current season",
  },
];

export function buildSettingsSummary(config: KitsuneConfig): string {
  return `${config.defaultMode} default  ·  discover ${config.discoverMode}  ·  series ${config.provider}  ·  anime ${config.animeProvider}`;
}

function configLabel(key: Parameters<typeof getConfigMetadata>[0]): string {
  return getConfigMetadata(key).label;
}

function describeDiscordClientId(config: KitsuneConfig): string {
  const source = resolvePresenceClientIdSource(config);
  if (source === "environment") return "env";
  if (config.presenceDiscordClientId.trim()) return "configured";
  return "bundled default";
}

function describeDiscordOpenUrl(config: KitsuneConfig): string {
  return config.presenceDiscordOpenUrl.trim() ? "configured" : "off";
}

function describeVideasySessionToken(config: KitsuneConfig): string {
  if (process.env.KUNAI_VIDEASY_SESSION_TOKEN?.trim()) return "env";
  return config.videasySessionToken.trim() ? "configured" : "missing";
}

export function buildSettingsOptions(
  config: KitsuneConfig,
  presenceSnapshot?: PresenceSnapshot | null,
): readonly ShellPickerOption<SettingsAction>[] {
  const presenceStatus =
    presenceSnapshot?.status ?? (config.presenceProvider === "off" ? "disabled" : "idle");
  const presenceConnected = config.presenceProvider === "discord" && presenceStatus === "ready";
  const presenceConnectionLabel =
    config.presenceProvider !== "discord"
      ? "Connect Discord now"
      : presenceConnected
        ? "Disconnect Discord"
        : presenceStatus === "unavailable" || presenceStatus === "error"
          ? "Reconnect Discord now"
          : "Connect Discord now";
  const presenceConnectionDetail =
    config.presenceProvider !== "discord"
      ? "Set Presence to Discord first, then connect local Discord IPC"
      : presenceConnected
        ? "Clear Rich Presence and close the local Discord IPC client"
        : presenceStatus === "unavailable" || presenceStatus === "error"
          ? "Retry local Discord IPC connection after a failed attempt"
          : "Save pending settings and verify local Discord IPC without starting playback";
  const presenceStatusDetail =
    presenceSnapshot?.detail ??
    (config.presenceProvider === "off"
      ? "off"
      : "ready to connect. Connect now to verify local Discord IPC.");

  return [
    {
      value: "section:general",
      label: "General",
      detail: "Launch mode and how much shortcut help the shell shows",
    },
    {
      value: "defaultMode",
      label: `▸ Default startup mode  ·  ${config.defaultMode}`,
      detail: "First catalog after launch: series/TV or anime (does not change mid-session mode)",
    },
    {
      value: "footerHints",
      label: `▸ ${configLabel("footerHints")}  ·  ${config.footerHints}`,
      detail: "Detailed = footer shows key legend; minimal = task line only during playback",
    },
    {
      value: "section:discover",
      label: "Discover",
      detail: "Home recommendations, /random, and startup discover tray",
    },
    {
      value: "discoverShowOnStartup",
      label: `${configLabel("discoverShowOnStartup")}  ·  ${
        config.discoverShowOnStartup ? "on" : "off"
      }`,
      detail: "Open recommendations first instead of the empty search home",
    },
    {
      value: "discoverMode",
      label: `▸ Discover mode  ·  ${config.discoverMode}`,
      detail: "Choose whether discover follows mode, mixes catalogs, or stays focused",
    },
    {
      value: "discoverItemLimit",
      label: `▸ Discover tray size  ·  ${config.discoverItemLimit} items`,
      detail: "How many results /discover, /random, and /surprise should stage",
    },
    {
      value: "recommendationRailEnabled",
      label: `Post-playback recommendations  ·  ${config.recommendationRailEnabled ? "on" : "off"}`,
      detail: "Show a compact recommendation rail after finishing playback",
    },
    {
      value: "section:providers",
      label: "Providers",
      detail: "Default resolver used before per-title overrides",
    },
    {
      value: "provider",
      label: `▸ Default provider  ·  ${config.provider}`,
      detail: "Movies and series: used on new searches until you pick another provider",
    },
    {
      value: "animeProvider",
      label: `▸ Anime provider  ·  ${config.animeProvider}`,
      detail: "Anime mode default: used on new anime searches until changed in-session",
    },
    {
      value: "videasySessionToken",
      label: `▸ ${configLabel("videasySessionToken")}  ·  ${describeVideasySessionToken(config)}`,
      detail:
        "Optional user-provided browser session for guarded VidKing/Bitcine Videasy API calls",
    },
    {
      value: "videasyAppId",
      label: `▸ ${configLabel("videasyAppId")}  ·  ${config.videasyAppId}`,
      detail: "Use vidking for Vidking embeds or bc-frontend for Bitcine sessions",
    },
    {
      value: "section:language",
      label: "Language",
      detail: "Preferred audio/subtitle tracks when a provider exposes choices",
    },
    {
      value: "animeAudio",
      label: `▸ Anime audio  ·  ${config.animeLanguageProfile.audio}`,
      detail: "Preferred anime audio track language",
    },
    {
      value: "animeSubtitle",
      label: `▸ Anime subtitles  ·  ${config.animeLanguageProfile.subtitle}`,
      detail: "Preferred anime subtitle behavior",
    },
    {
      value: "seriesAudio",
      label: `▸ Series audio  ·  ${config.seriesLanguageProfile.audio}`,
      detail: "Preferred series audio track language",
    },
    {
      value: "seriesSubtitle",
      label: `▸ Series subtitles  ·  ${config.seriesLanguageProfile.subtitle}`,
      detail: "Preferred series subtitle behavior",
    },
    {
      value: "movieAudio",
      label: `▸ Movie audio  ·  ${config.movieLanguageProfile.audio}`,
      detail: "Preferred movie audio track language",
    },
    {
      value: "movieSubtitle",
      label: `▸ Movie subtitles  ·  ${config.movieLanguageProfile.subtitle}`,
      detail: "Preferred movie subtitle behavior",
    },
    {
      value: "animeTitlePreference",
      label: `▸ Anime title names  ·  ${config.animeTitlePreference}`,
      detail: "Choose English, Romaji, native, or provider titles in anime search",
    },
    {
      value: "section:playback",
      label: "Playback",
      detail: "Autoplay chain, intro skip, recovery, memory panel, and offline downloads",
    },
    {
      value: "showMemory",
      label: `Memory panel  ·  ${config.showMemory ? "pinned after m" : "temporary after m"}`,
      detail:
        "Hidden by default. Press m during playback for app, mpv, total, heap, and swap usage",
    },
    {
      value: "recoveryMode",
      label: `▸ ${configLabel("recoveryMode")}  ·  ${config.recoveryMode}`,
      detail: "Choose how aggressively Kunai retries and switches providers",
    },
    {
      value: "startupPriority",
      label: `▸ ${configLabel("startupPriority")}  ·  ${config.startupPriority}`,
      detail: "Choose how long provider startup waits for richer stream choices",
    },
    {
      value: "section:offline-continuation",
      label: "Offline continuation",
      detail: "Enable Keep watching offline per title; streaming never downloads automatically",
    },
    {
      value: "downloadsEnabled",
      label: `Offline downloads  ·  ${config.downloadsEnabled ? "enabled" : "off"}`,
      detail: "Enable local completed downloads and the offline library surface",
    },
    {
      value: "powerSaverMode",
      label: `Power Saver  ·  ${config.powerSaverMode ? "on" : "off"}`,
      detail: "Pause speculative prefetch, passive refresh, artwork warming, and runway refills",
    },
    {
      value: "autoCleanupWatched",
      label: `▸ Auto-cleanup  ·  ${
        config.autoCleanupWatched ? `on (${config.autoCleanupGraceDays} day grace)` : "off"
      }`,
      detail: "Flag watched completed downloads for explicit cleanup after the grace period",
    },
    {
      value: "autoCleanupGraceDays",
      label: `▸ Cleanup grace  ·  ${config.autoCleanupGraceDays} ${
        config.autoCleanupGraceDays === 1 ? "day" : "days"
      }`,
      detail: "How long watched downloads stay before they appear as cleanup candidates",
    },
    {
      value: "downloadPath",
      label: `▸ Download path  ·  ${config.downloadPath.trim() ? "configured" : "default"}`,
      detail: config.downloadPath.trim() || "Use Kunai's app data directory",
    },
    {
      value: "autoNext",
      label: `Autoplay next  ·  ${config.autoNext ? "on" : "off"}`,
      detail: "Close mpv on EOF and continue through the next available released episode",
    },
    {
      value: "resumeStartChoicePrompt",
      label: `Resume vs start-over prompt  ·  ${config.resumeStartChoicePrompt ? "on" : "off"}`,
      detail:
        "When autoplay resumes mid-episode, show mpv overlay (R/O) before seeking; off jumps straight to saved time",
    },
    {
      value: "quitNearEndBehavior",
      label: `Quit near end  ·  ${config.quitNearEndBehavior}`,
      detail: "Whether quitting mpv near the natural end can still trigger auto-next",
    },
    {
      value: "quitNearEndThresholdMode",
      label: `Near-end detection  ·  ${config.quitNearEndThresholdMode}`,
      detail: "How Kunai decides you were “close enough” to the end for quit + completion",
    },
    {
      value: "skipRecap",
      label: `Skip recaps  ·  ${config.skipRecap ? "on" : "off"}`,
      detail: "Auto-skip recap segments when IntroDB timing exists",
    },
    {
      value: "skipIntro",
      label: `Skip intros  ·  ${config.skipIntro ? "on" : "off"}`,
      detail: "Auto-skip intro segments when IntroDB timing exists",
    },
    {
      value: "skipCredits",
      label: `Skip credits  ·  ${config.skipCredits ? "on" : "off"}`,
      detail: "Auto-skip credits segments when IntroDB or AniSkip timing exists",
    },
    { value: "section:presence", label: "Presence", detail: "Discord status integration" },
    {
      value: "presenceProvider",
      label: `▸ Presence  ·  ${config.presenceProvider}`,
      detail: "Optional local social presence integration. Off by default.",
    },
    {
      value: "presencePrivacy",
      label: `▸ Presence privacy  ·  ${config.presencePrivacy}`,
      detail: "Controls how much title detail presence integrations may expose",
    },
    {
      value: "presenceStatus",
      label: `Discord status  ·  ${presenceStatus}`,
      detail: presenceStatusDetail,
      tone:
        presenceStatus === "ready"
          ? "success"
          : presenceStatus === "unavailable" || presenceStatus === "error"
            ? "warning"
            : "info",
    },
    {
      value: "presenceDiscordClientId",
      label: `▸ Discord client ID  ·  ${describeDiscordClientId(config)}`,
      detail: "Type a Discord application client id, or use KUNAI_DISCORD_CLIENT_ID",
    },
    {
      value: "presenceDiscordOpenUrl",
      label: `▸ Discord open URL  ·  ${describeDiscordOpenUrl(config)}`,
      detail: "Reserved for future handoffs; catalog buttons are auto-built from title ids",
    },
    {
      value: "presenceConnection",
      label: presenceConnectionLabel,
      detail: presenceConnectionDetail,
    },
    {
      value: "section:storage",
      label: "Danger Zone",
      detail: "Destructive — irreversible actions",
    },
    {
      value: "clearCache",
      label: "Clear stream cache",
      detail: "Wipe the local SQLite stream cache",
      tone: "error" as const,
    },
    {
      value: "clearHistory",
      label: "Clear watch history",
      detail: "Reset all watch progress and history",
      tone: "error" as const,
    },
  ];
}

export function buildSettingsProviderOptions({
  providers,
  currentProvider,
}: {
  providers: readonly import("@/domain/types").ProviderMetadata[];
  currentProvider: string;
}): readonly ShellPickerOption<string>[] {
  return providers.map((provider) => ({
    value: provider.id,
    label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
    detail: provider.description,
  }));
}

export function buildSettingsChoiceOverlay({
  config,
  setting,
  seriesProviderOptions,
  animeProviderOptions,
  parentSelectedIndex = 0,
}: {
  config: KitsuneConfig;
  setting: SettingsChoiceValue;
  seriesProviderOptions: readonly ShellPickerOption<string>[];
  animeProviderOptions: readonly ShellPickerOption<string>[];
  parentSelectedIndex?: number;
}): Extract<BrowseOverlay, { type: "settings-choice" }> {
  let title = "Choose setting";
  let subtitle = "Select a value";
  let options: readonly ShellPickerOption<string>[] = [];

  if (setting === "defaultMode") {
    title = "Default startup mode";
    subtitle = `Current ${config.defaultMode}`;
    options = [
      { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
      { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
    ].map((option) => ({
      ...option,
      label: option.value === config.defaultMode ? `${option.label}  ·  current` : option.label,
    }));
  } else if (setting === "provider") {
    title = "Default provider";
    subtitle = `Current ${config.provider}`;
    options = seriesProviderOptions.map((option) => ({
      ...option,
      label:
        option.value === config.provider
          ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
          : option.label.replace(/  ·  current$/, ""),
    }));
  } else if (setting === "animeProvider") {
    title = "Anime provider";
    subtitle = `Current ${config.animeProvider}`;
    options = animeProviderOptions.map((option) => ({
      ...option,
      label:
        option.value === config.animeProvider
          ? `${option.label.replace(/  ·  current$/, "")}  ·  current`
          : option.label.replace(/  ·  current$/, ""),
    }));
  } else if (setting === "animeAudio") {
    title = "Anime audio";
    subtitle = `Current ${config.animeLanguageProfile.audio}`;
    options = AUDIO_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.animeLanguageProfile.audio
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "animeSubtitle") {
    title = "Anime subtitles";
    subtitle = `Current ${config.animeLanguageProfile.subtitle}`;
    options = SUBTITLE_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.animeLanguageProfile.subtitle
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "seriesAudio") {
    title = "Series audio";
    subtitle = `Current ${config.seriesLanguageProfile.audio}`;
    options = AUDIO_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.seriesLanguageProfile.audio
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "seriesSubtitle") {
    title = "Series subtitles";
    subtitle = `Current ${config.seriesLanguageProfile.subtitle}`;
    options = SUBTITLE_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.seriesLanguageProfile.subtitle
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "movieAudio") {
    title = "Movie audio";
    subtitle = `Current ${config.movieLanguageProfile.audio}`;
    options = AUDIO_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.movieLanguageProfile.audio
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "movieSubtitle") {
    title = "Movie subtitles";
    subtitle = `Current ${config.movieLanguageProfile.subtitle}`;
    options = SUBTITLE_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.movieLanguageProfile.subtitle
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "animeTitlePreference") {
    title = "Anime title names";
    subtitle = `Current ${config.animeTitlePreference}`;
    options = ANIME_TITLE_SETTINGS_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.animeTitlePreference ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "footerHints") {
    title = "Footer hint density";
    subtitle = `Current ${config.footerHints}`;
    options = FOOTER_HINT_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.footerHints ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "discoverMode") {
    title = "Discover mode";
    subtitle = `Current ${config.discoverMode}`;
    options = DISCOVER_MODE_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.discoverMode ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "discoverItemLimit") {
    title = "Discover tray size";
    subtitle = `Current ${config.discoverItemLimit} items`;
    options = DISCOVER_ITEM_LIMIT_OPTIONS.map((option) => ({
      ...option,
      label:
        Number(option.value) === config.discoverItemLimit
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "autoDownload") {
    title = "Auto-download";
    subtitle = `Current ${config.autoDownload}`;
    options = AUTO_DOWNLOAD_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.autoDownload ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "recoveryMode") {
    title = "Recovery mode";
    subtitle = `Current ${config.recoveryMode}`;
    options = RECOVERY_MODE_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.recoveryMode ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "startupPriority") {
    title = "Startup priority";
    subtitle = `Current ${config.startupPriority}`;
    options = STARTUP_PRIORITY_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.startupPriority ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "autoDownloadNextCount") {
    title = "Auto-download next count";
    subtitle = `Current ${config.autoDownloadNextCount}`;
    options = AUTO_DOWNLOAD_NEXT_COUNT_OPTIONS.map((option) => ({
      ...option,
      label:
        Number(option.value) === config.autoDownloadNextCount
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "autoCleanupGraceDays") {
    title = "Cleanup grace";
    subtitle = `Current ${config.autoCleanupGraceDays} days`;
    options = AUTO_CLEANUP_GRACE_DAY_OPTIONS.map((option) => ({
      ...option,
      label:
        Number(option.value) === config.autoCleanupGraceDays
          ? `${option.label}  ·  current`
          : option.label,
    }));
  } else if (setting === "downloadPath") {
    title = "Download path";
    subtitle = config.downloadPath.trim()
      ? `Current ${config.downloadPath.trim()}`
      : "Using default Kunai app data directory";
    options = [
      {
        value: "__keep__",
        label: "Keep current path",
        detail: "Type an absolute path to filter, then press Enter to draft it",
      },
      {
        value: "__clear__",
        label: "Use Kunai default path",
        detail: "Clear the override and let Kunai choose the platform app-data directory",
      },
    ];
  } else if (setting === "presenceProvider") {
    title = "Presence integration";
    subtitle = `Current ${config.presenceProvider}`;
    options = PRESENCE_PROVIDER_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.presenceProvider ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "presencePrivacy") {
    title = "Presence privacy";
    subtitle = `Current ${config.presencePrivacy}`;
    options = PRESENCE_PRIVACY_OPTIONS.map((option) => ({
      ...option,
      label: option.value === config.presencePrivacy ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "presenceDiscordClientId") {
    title = "Discord client ID";
    subtitle =
      describeDiscordClientId(config) === "env"
        ? "Using KUNAI_DISCORD_CLIENT_ID unless a config value is typed here"
        : `Current ${describeDiscordClientId(config)}`;
    options = [
      {
        value: "__keep__",
        label: "Keep current value",
        detail: "Type a numeric client id to filter, then press Enter to draft it",
      },
      {
        value: "__clear__",
        label: "Clear configured client id",
        detail: "Fall back to KUNAI_DISCORD_CLIENT_ID, or show missing if the env var is unset",
      },
      ...(process.env.KUNAI_DISCORD_CLIENT_ID?.trim()
        ? [
            {
              value: "__env__",
              label: "Use environment client id",
              detail: "Keep config empty and read KUNAI_DISCORD_CLIENT_ID at connect time",
            },
          ]
        : []),
    ];
  } else if (setting === "presenceDiscordOpenUrl") {
    title = "Discord open URL";
    subtitle = config.presenceDiscordOpenUrl.trim()
      ? `Current ${config.presenceDiscordOpenUrl.trim()}`
      : "No Discord handoff button configured";
    options = [
      {
        value: "__keep__",
        label: "Keep current URL",
        detail: "Type a safe https:// or kunai:// URL to filter, then press Enter to draft it",
      },
      {
        value: "__clear__",
        label: "Clear open button",
        detail: "Remove the optional Open in Kunai Discord activity button",
      },
    ];
  } else if (setting === "videasySessionToken") {
    title = "Videasy session token";
    subtitle =
      describeVideasySessionToken(config) === "env"
        ? "Using KUNAI_VIDEASY_SESSION_TOKEN unless a config value is typed here"
        : `Current ${describeVideasySessionToken(config)}`;
    options = [
      {
        value: "__keep__",
        label: "Keep current value",
        detail: "Type a Videasy session token to filter, then press Enter to draft it",
      },
      {
        value: "__clear__",
        label: "Clear configured token",
        detail: "Fall back to KUNAI_VIDEASY_SESSION_TOKEN, or show missing if the env var is unset",
      },
      ...(process.env.KUNAI_VIDEASY_SESSION_TOKEN?.trim()
        ? [
            {
              value: "__env__",
              label: "Use environment token",
              detail: "Keep config empty and read KUNAI_VIDEASY_SESSION_TOKEN at resolve time",
            },
          ]
        : []),
    ];
  } else if (setting === "videasyAppId") {
    title = "Videasy app id";
    subtitle = `Current ${config.videasyAppId}`;
    options = [
      {
        value: "vidking",
        label: "Vidking",
        detail: "Use sessions minted by the public vidking.net embed player",
      },
      {
        value: "bc-frontend",
        label: "Bitcine",
        detail: "Use sessions minted by bitcine.tv playback pages",
      },
    ];
  } else if (setting === "quitNearEndBehavior") {
    title = "Quit near end";
    subtitle = `Current ${config.quitNearEndBehavior}`;
    options = QUIT_NEAR_END_BEHAVIOR_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.quitNearEndBehavior ? `${option.label}  ·  current` : option.label,
    })) as readonly ShellPickerOption<string>[];
  } else if (setting === "quitNearEndThresholdMode") {
    title = "Near-end detection";
    subtitle = `Current ${config.quitNearEndThresholdMode}`;
    options = QUIT_THRESHOLD_MODE_OPTIONS.map((option) => ({
      ...option,
      label:
        option.value === config.quitNearEndThresholdMode
          ? `${option.label}  ·  current`
          : option.label,
    })) as readonly ShellPickerOption<string>[];
  }

  return {
    type: "settings-choice",
    title,
    subtitle,
    setting,
    options,
    filterQuery: "",
    selectedIndex: 0,
    parentSelectedIndex,
    busy: false,
  };
}

export function settingsEqual(
  left: KitsuneConfig | null | undefined,
  right: KitsuneConfig | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function resolvePanelTone(tone: ShellPanelLine["tone"]): string {
  return statusColor(tone ?? "neutral");
}

/** Matches panel border/title accents for picker list focus styling. */
function pickerFocusAccent(type: Extract<BrowseOverlay, { filterQuery: string }>["type"]): string {
  if (type === "settings" || type === "settings-choice") return palette.ok;
  return palette.accent;
}

// Right-hand preview rail for the episode picker. The poster slot is height-
// reserved so the metadata below it never jumps when artwork resolves (spec:
// episode-season-picker.md). Falls back to a quiet placeholder before/without art.
const EpisodePreviewRail = React.memo(function EpisodePreviewRail({
  poster,
  posterState,
  option,
  width,
}: {
  poster: PosterResult;
  posterState: PosterState;
  option: ShellPickerOption<string> | undefined;
  width: number;
}) {
  const badgeColor =
    option?.tone === "success"
      ? palette.ok
      : option?.tone === "warning"
        ? palette.accentDeep
        : option?.tone === "error"
          ? palette.danger
          : palette.muted;
  return (
    <Box flexDirection="column" width={width} marginLeft={2} flexShrink={0}>
      <Box height={6} width={width}>
        {poster.kind !== "none" ? (
          <Text>{poster.placeholder}</Text>
        ) : (
          <Text color={palette.dim} dimColor>
            {posterState === "loading" ? "loading artwork…" : "no preview art"}
          </Text>
        )}
      </Box>
      {option ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.text} bold>
            {truncateAtWord(option.label, Math.max(8, width))}
          </Text>
          {option.badge ? <Text color={badgeColor}>{option.badge}</Text> : null}
          {option.detail ? (
            <Text color={palette.dim}>{truncateAtWord(option.detail, Math.max(8, width))}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
});

export function OverlayPanel({
  overlay,
  width,
  maxLinesOverride,
}: {
  overlay: BrowseOverlay;
  width: number;
  maxLinesOverride?: number;
}) {
  const contentWidth = Math.max(24, width - 4);
  const maxLines = maxLinesOverride ?? (overlay.type === "episode-picker" ? 8 : 6);
  const isPickerOverlay =
    overlay.type === "provider" ||
    overlay.type === "history-picker" ||
    overlay.type === "settings" ||
    overlay.type === "settings-choice" ||
    overlay.type === "episode-picker";
  const isLineOverlay =
    overlay.type === "help" ||
    overlay.type === "about" ||
    overlay.type === "diagnostics" ||
    overlay.type === "history" ||
    overlay.type === "details";
  const optionWindowStart = isPickerOverlay
    ? getWindowStart(overlay.selectedIndex, overlay.options.length, maxLines)
    : 0;
  const optionWindowEnd = optionWindowStart + maxLines;
  const visibleOptions = isPickerOverlay
    ? overlay.options.slice(optionWindowStart, optionWindowEnd)
    : [];
  const pickerAccent = isPickerOverlay
    ? pickerFocusAccent((overlay as Extract<BrowseOverlay, { filterQuery: string }>).type)
    : palette.accent;
  const busySpinner = useBusySpinner(
    isPickerOverlay && Boolean((overlay as { busy?: boolean }).busy),
  );
  const pickerPreviewImageUrl = getOverlayPickerPreviewImageUrl(overlay);
  const { poster: pickerPoster, posterState: pickerPosterState } = usePosterPreview(
    pickerPreviewImageUrl,
    {
      rows: 6,
      cols: 16,
      enabled: overlay.type === "episode-picker" && Boolean(pickerPreviewImageUrl),
      debounceMs: 120,
    },
  );
  // Two-pane episode picker: dense list (left) + anchored preview rail (right).
  // The rail hides first on narrow terminals (spec: responsive). When shown it
  // takes a fixed column so the list width — and every row — stays stable.
  const railColumnWidth = 20;
  const showPreviewRail = overlay.type === "episode-picker" && contentWidth >= 56;
  const listContentWidth = showPreviewRail
    ? Math.max(18, contentWidth - railColumnWidth - 2)
    : contentWidth;

  return (
    <Box marginTop={1} flexDirection="column" paddingX={1}>
      <Text color={palette.text} bold>
        {overlay.title}
      </Text>
      <Text color={palette.dim}>{overlay.subtitle}</Text>
      {isPickerOverlay ? (
        <>
          <Box marginTop={1}>
            {overlay.filterQuery.length > 0 ? (
              <>
                <Text color={pickerAccent}>Filter: </Text>
                <Text color={palette.text} bold>
                  {overlay.filterQuery}
                </Text>
              </>
            ) : overlay.type === "history-picker" && overlay.filterMode ? (
              <Box flexDirection="row">
                {(["all", "watching", "completed"] as const).map((mode) => {
                  const active = overlay.filterMode === mode;
                  return (
                    <Box key={mode} marginRight={3} flexDirection="column">
                      <Text color={active ? palette.accent : palette.muted}>{mode}</Text>
                      {active ? (
                        <Text color={palette.accent}>{"─".repeat(mode.length)}</Text>
                      ) : null}
                    </Box>
                  );
                })}
                <Text color={palette.dim} dimColor>
                  Tab cycle
                </Text>
              </Box>
            ) : (
              <Text color={palette.dim}>
                {overlay.type === "provider"
                  ? "Type to narrow providers"
                  : overlay.type === "history-picker"
                    ? "Type to narrow history (or filter by 'completed', 'watching')"
                    : overlay.type === "episode-picker"
                      ? "Type to narrow episodes"
                      : "Type to narrow this list"}
              </Text>
            )}
          </Box>
          <Box marginTop={1} flexDirection="row">
            <Box flexDirection="column" flexGrow={1}>
              {optionWindowStart > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
              {visibleOptions.map((option, index) => {
                const optionIndex = optionWindowStart + index;
                const selected = optionIndex === overlay.selectedIndex;
                // Section separator — render as a non-selectable group header
                if (typeof option.value === "string" && option.value.startsWith("section:")) {
                  const isSettings =
                    overlay.type === "settings" || overlay.type === "settings-choice";
                  const isHistory = overlay.type === "history-picker";
                  const headerLabel = option.label.toUpperCase();
                  const usesAccent = isSettings || isHistory;
                  return (
                    <Box key={`section-${option.value}`} marginTop={1} flexDirection="column">
                      <Text color={usesAccent ? palette.text : palette.dim} bold={usesAccent}>
                        {headerLabel}
                      </Text>
                      {usesAccent ? (
                        <Text color={palette.accent}>{"─".repeat(headerLabel.length)}</Text>
                      ) : null}
                    </Box>
                  );
                }
                const rowAccentColor =
                  option.tone === "success"
                    ? palette.ok
                    : option.tone === "warning"
                      ? palette.accentDeep
                      : option.tone === "info"
                        ? palette.muted
                        : option.tone === "error"
                          ? palette.danger
                          : null;
                // Treatment C: selection is shown by a single accent bar (rendered by
                // PickerOptionRow) + the elevated surface, not per-row ✓/▶/○ marker soup.
                // Watched/current/resume state is carried by row tone + trailing badge + detail.
                // Derive dot indicator for settings rows
                const isSettingsOverlay =
                  overlay.type === "settings" || overlay.type === "settings-choice";
                const settingsLabel = option.label;
                const isSettingsChoice = isSettingsOverlay && settingsLabel.startsWith("▸");
                const settingsToggleOn =
                  isSettingsOverlay &&
                  !isSettingsChoice &&
                  (settingsLabel.endsWith("· on") ||
                    settingsLabel.endsWith("· enabled") ||
                    settingsLabel.endsWith("· pinned after m") ||
                    option.tone === "success");
                const settingsToggleOff =
                  isSettingsOverlay &&
                  !isSettingsChoice &&
                  (settingsLabel.endsWith("· off") ||
                    settingsLabel.endsWith("· temporary after m"));
                const showSettingsSwitch =
                  isSettingsOverlay && (settingsToggleOn || settingsToggleOff);
                const effectiveLabel = option.label;
                const isHistoryPicker = overlay.type === "history-picker";
                const historyPosterWidth = 4;
                const prefixWidth =
                  (showSettingsSwitch ? 8 : 0) +
                  (isHistoryPicker && option.posterTitle ? historyPosterWidth + 1 : 0);
                const historyRowWidth = Math.max(0, listContentWidth - prefixWidth);
                return (
                  <Box
                    key={`${option.value}-${optionIndex}`}
                    backgroundColor={selected ? palette.surfaceActive : undefined}
                    flexDirection="row"
                  >
                    {showSettingsSwitch ? <BooleanSwitch on={settingsToggleOn} /> : null}
                    {isHistoryPicker && option.posterTitle ? (
                      <Box marginRight={1}>
                        <PosterInitialBlock
                          title={option.posterTitle}
                          width={historyPosterWidth}
                          height={3}
                        />
                      </Box>
                    ) : null}
                    <Box flexDirection="column" flexGrow={1}>
                      <Text bold={selected} wrap="truncate-end">
                        <PickerOptionRow
                          label={effectiveLabel}
                          detail={option.detail}
                          badge={option.badge}
                          width={historyRowWidth}
                          selected={selected}
                          accentColor={rowAccentColor}
                          pickerAccent={pickerAccent}
                        />
                      </Text>
                      {isHistoryPicker && option.historyProgress ? (
                        <Text
                          color={option.historyProgress.completed ? palette.ok : palette.accent}
                        >
                          {renderHistoryProgressBar(option.historyProgress.percentage)}
                          {`  ${option.historyProgress.percentage}%`}
                        </Text>
                      ) : null}
                    </Box>
                  </Box>
                );
              })}
              {optionWindowEnd < overlay.options.length ? (
                <Text color={palette.dim}> ▼ ...</Text>
              ) : null}
            </Box>
            {showPreviewRail ? (
              <EpisodePreviewRail
                poster={pickerPoster}
                posterState={pickerPosterState}
                option={overlay.options[overlay.selectedIndex]}
                width={railColumnWidth}
              />
            ) : null}
          </Box>
          {overlay.busy || overlay.type !== "episode-picker" ? (
            <Box marginTop={1}>
              <Text color={overlay.busy ? palette.accent : palette.dim}>
                {overlay.busy
                  ? `${busySpinner} ${
                      overlay.type === "provider"
                        ? "Updating provider…"
                        : overlay.type === "history-picker"
                          ? "Loading history…"
                          : "Saving settings…"
                    }`
                  : `${overlay.options.length} items  ·  ↑↓ choose · Enter select · Esc close`}
              </Text>
            </Box>
          ) : null}
          {overlay.type === "settings" ? (
            <Box marginTop={1}>
              <Text color={overlay.dirty ? palette.accent : palette.dim}>
                {overlay.dirty ? "s save" : "s close"}
              </Text>
              <Text color={palette.dim}>{"  "}</Text>
              <Text color={palette.dim}>{overlay.dirty ? "esc discard" : "esc close"}</Text>
            </Box>
          ) : null}
        </>
      ) : isLineOverlay && overlay.loading ? (
        <Box marginTop={1}>
          <Text color={palette.accent}>Loading panel…</Text>
        </Box>
      ) : isLineOverlay ? (
        <Box marginTop={1} flexDirection="column">
          {overlay.lines
            .slice(overlay.scrollIndex ?? 0, (overlay.scrollIndex ?? 0) + maxLines)
            .map((line: ShellPanelLine) => {
              const isHeader = !line.detail && line.label.startsWith("───");
              if (isHeader) {
                // Section rule — small top gap for grouping, no per-line blank lines.
                return (
                  <Box key={`${line.label}-h`} marginTop={1}>
                    <Text color={palette.muted}>{truncateLine(line.label, contentWidth)}</Text>
                  </Box>
                );
              }
              const labelWidth = Math.min(16, Math.max(8, Math.floor(contentWidth * 0.26)));
              const detailLines = line.detail
                ? wrapText(line.detail, contentWidth - labelWidth - 1, 6)
                : [];
              // Short fact → inline "label  value"; long detail (synopsis) → label
              // then wrapped body. Either way: no blank line between facts.
              if (detailLines.length <= 1) {
                return (
                  <Box key={`${line.label}-${line.detail ?? ""}`}>
                    <Text color={resolvePanelTone(line.tone)}>
                      {truncateLine(line.label, labelWidth).padEnd(labelWidth)}
                    </Text>
                    <Text color={palette.dim}>{detailLines[0] ?? ""}</Text>
                  </Box>
                );
              }
              return (
                <Box key={`${line.label}-multi`} flexDirection="column">
                  <Text color={resolvePanelTone(line.tone)}>
                    {truncateLine(line.label, contentWidth)}
                  </Text>
                  {detailLines.map((detailLine) => (
                    <Text key={`${line.label}-${detailLine}`} color={palette.dim}>
                      {detailLine}
                    </Text>
                  ))}
                </Box>
              );
            })}
          <Text color={palette.dim}>
            {overlay.lines.length > maxLines
              ? `Showing ${(overlay.scrollIndex ?? 0) + 1}-${Math.min(
                  (overlay.scrollIndex ?? 0) + maxLines,
                  overlay.lines.length,
                )} of ${overlay.lines.length}  ·  ↑↓ scroll  ·  Esc closes`
              : "Esc closes this panel"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
