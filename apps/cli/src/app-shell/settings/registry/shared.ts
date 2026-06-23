import { getConfigMetadata } from "@/services/persistence/config-metadata";
import type {
  DiscoverMode,
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
} from "@/services/persistence/ConfigService";
import { resolvePresenceClientIdSource } from "@/services/presence/PresenceServiceImpl";
import type { StartupPriority } from "@kunai/types";

import type { EnumOption } from "../types";

export const SUBTITLE_SETTINGS_OPTIONS: readonly EnumOption[] = [
  { value: "en", label: "English" },
  { value: "interactive", label: "Pick interactively" },
  { value: "none", label: "None" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
];

export const AUDIO_SETTINGS_OPTIONS: readonly EnumOption[] = [
  { value: "original", label: "Original", detail: "Prefer original/native audio" },
  { value: "en", label: "English", detail: "Prefer English audio when available" },
  { value: "ja", label: "Japanese", detail: "Prefer Japanese audio when available" },
  { value: "dub", label: "Dub", detail: "Prefer dubbed audio when available" },
];

export const ANIME_TITLE_SETTINGS_OPTIONS: readonly EnumOption[] = [
  { value: "english", label: "English", detail: "Prefer localized English titles when known" },
  { value: "romaji", label: "Romaji", detail: "Prefer romanized Japanese titles" },
  { value: "native", label: "Native", detail: "Prefer native Japanese titles" },
  { value: "provider", label: "Provider", detail: "Use the title returned by the active provider" },
];

export const QUIT_NEAR_END_BEHAVIOR_OPTIONS: readonly EnumOption[] = [
  {
    value: "continue" satisfies QuitNearEndBehavior,
    label: "Continue",
    detail: "Quitting mpv near the end still allows auto-next when enabled",
  },
  {
    value: "pause" satisfies QuitNearEndBehavior,
    label: "Pause chain",
    detail: "Quitting mpv always stops the auto-next chain (EOF still advances)",
  },
];

export const CONTINUE_SOURCE_PREFERENCE_OPTIONS: readonly EnumOption[] = [
  {
    value: "auto",
    label: "Auto",
    detail: "Prefer ready local copy when available, otherwise stream",
  },
  {
    value: "local",
    label: "Local",
    detail: "Prefer offline playback when a ready download exists",
  },
  {
    value: "stream",
    label: "Stream",
    detail: "Prefer online playback when a stream source exists",
  },
  {
    value: "ask",
    label: "Ask",
    detail: "Prompt for local vs stream when both sources are available",
  },
];

export const QUIT_THRESHOLD_MODE_OPTIONS: readonly EnumOption[] = [
  {
    value: "credits-or-90-percent" satisfies QuitNearEndThresholdMode,
    label: "Credits or last 5s",
    detail: "Prefer AniSkip/IntroDB credits start, else last five seconds",
  },
  {
    value: "percent-only" satisfies QuitNearEndThresholdMode,
    label: "95% watched",
    detail: "Treat as near-end when watched ≥ 95% of reported duration",
  },
  {
    value: "seconds-only" satisfies QuitNearEndThresholdMode,
    label: "Last 5 seconds",
    detail: "Ignore segment timing; only last five seconds count as near-end",
  },
];

export const FOOTER_HINT_OPTIONS: readonly EnumOption[] = [
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

export const DISCOVER_MODE_OPTIONS: readonly EnumOption[] = [
  {
    value: "auto" satisfies DiscoverMode,
    label: "Auto",
    detail: "Follow the current shell mode when building discovery lists",
  },
  {
    value: "unified" satisfies DiscoverMode,
    label: "Unified",
    detail: "Mix anime and series when both catalogs are available",
  },
  {
    value: "anime-only" satisfies DiscoverMode,
    label: "Anime only",
    detail: "Keep discovery and surprise focused on anime",
  },
  {
    value: "series-only" satisfies DiscoverMode,
    label: "Series only",
    detail: "Keep discovery and surprise focused on shows and movies",
  },
];

export const DISCOVER_ITEM_LIMIT_OPTIONS: readonly EnumOption[] = [12, 24, 36, 48, 80].map(
  (count) => ({
    value: String(count),
    label: `${count} items`,
    detail: count <= 24 ? "Lean tray with quicker scanning" : "Bigger tray for browsing sessions",
  }),
);

export const AUTO_CLEANUP_GRACE_DAY_OPTIONS: readonly EnumOption[] = [0, 1, 3, 7, 14, 30].map(
  (days) => ({
    value: String(days),
    label: days === 0 ? "Immediately" : days === 1 ? "1 day" : `${days} days`,
    detail:
      days === 0
        ? "Show watched downloads as cleanup candidates immediately"
        : `Wait ${days} day${days === 1 ? "" : "s"} after watch completion`,
  }),
);

export const RECOVERY_MODE_OPTIONS: readonly EnumOption[] = [
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

export const STARTUP_PRIORITY_OPTIONS: readonly EnumOption[] = [
  {
    value: "balanced" satisfies StartupPriority,
    label: "Balanced",
    detail: "Prefer ready 1080p playback without a long wait.",
  },
  {
    value: "fast" satisfies StartupPriority,
    label: "Fast",
    detail: "Start the first healthy playable source.",
  },
  {
    value: "quality-first" satisfies StartupPriority,
    label: "Quality first",
    detail: "Wait longer for stronger quality choices.",
  },
];

export const PRESENCE_PROVIDER_OPTIONS: readonly EnumOption[] = [
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

export const PRESENCE_PRIVACY_OPTIONS: readonly EnumOption[] = [
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

export function configLabel(key: Parameters<typeof getConfigMetadata>[0]): string {
  return getConfigMetadata(key).label;
}

export function describeDiscordClientId(config: KitsuneConfig): string {
  const source = resolvePresenceClientIdSource(config);
  if (source === "environment") return "env";
  if (config.presenceDiscordClientId?.trim()) return "configured";
  return "bundled default";
}

export function describeDiscordOpenUrl(config: KitsuneConfig): string {
  return config.presenceDiscordOpenUrl?.trim() ? "configured" : "off";
}

export function describeVideasySessionToken(config: KitsuneConfig): string {
  if (process.env.KUNAI_VIDEASY_SESSION_TOKEN?.trim()) return "env";
  return config.videasySessionToken?.trim() ? "configured" : "missing";
}
