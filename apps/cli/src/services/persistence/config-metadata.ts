import type { KitsuneConfig } from "./ConfigService";

export type ConfigSection =
  | "general"
  | "recommendations"
  | "providers"
  | "language"
  | "playback"
  | "offline"
  | "presence"
  | "updates";

export type ConfigEffectTiming = "immediate" | "after-save" | "next-resolve" | "next-playback";

export type ConfigPrivacy = "local" | "sensitive";

export type ConfigMetadataEntry<K extends keyof KitsuneConfig = keyof KitsuneConfig> = {
  readonly key: K;
  readonly label: string;
  readonly section: ConfigSection;
  readonly effect: ConfigEffectTiming;
  readonly privacy: ConfigPrivacy;
  readonly editable: boolean;
  readonly options?: readonly string[];
  readonly envOverride?: string;
};

export const CONFIG_METADATA = [
  {
    key: "defaultMode",
    label: "Default startup mode",
    section: "general",
    effect: "after-save",
    privacy: "local",
    editable: true,
    options: ["series", "anime"],
  },
  {
    key: "footerHints",
    label: "Footer hints",
    section: "general",
    effect: "immediate",
    privacy: "local",
    editable: true,
    options: ["detailed", "minimal"],
  },
  {
    key: "discoverShowOnStartup",
    label: "Recommendations on startup",
    section: "recommendations",
    effect: "after-save",
    privacy: "local",
    editable: true,
    options: ["on", "off"],
  },
  {
    key: "discoverMode",
    label: "Recommendation mode",
    section: "recommendations",
    effect: "after-save",
    privacy: "local",
    editable: true,
    options: ["auto", "unified", "anime-only", "series-only"],
  },
  {
    key: "recommendationRailEnabled",
    label: "Post-playback recommendations",
    section: "recommendations",
    effect: "immediate",
    privacy: "local",
    editable: true,
    options: ["on", "off"],
  },
  {
    key: "recoveryMode",
    label: "Recovery mode",
    section: "playback",
    effect: "next-playback",
    privacy: "local",
    editable: true,
    options: ["guided", "fallback-first", "manual"],
  },
  {
    key: "startupPriority",
    label: "Startup priority",
    section: "playback",
    effect: "next-resolve",
    privacy: "local",
    editable: true,
    options: ["balanced", "fast", "quality-first"],
  },
  {
    key: "downloadsEnabled",
    label: "Offline downloads",
    section: "offline",
    effect: "after-save",
    privacy: "local",
    editable: true,
    options: ["on", "off"],
  },
  {
    key: "powerSaverMode",
    label: "Power Saver",
    section: "offline",
    effect: "immediate",
    privacy: "local",
    editable: true,
    options: ["on", "off"],
  },
  {
    key: "downloadPath",
    label: "Download path",
    section: "offline",
    effect: "after-save",
    privacy: "sensitive",
    editable: true,
  },
  {
    key: "presenceProvider",
    label: "Presence",
    section: "presence",
    effect: "after-save",
    privacy: "local",
    editable: true,
    options: ["off", "discord"],
  },
  {
    key: "presencePrivacy",
    label: "Presence privacy",
    section: "presence",
    effect: "immediate",
    privacy: "local",
    editable: true,
    options: ["full", "private"],
  },
  {
    key: "presenceDiscordClientId",
    label: "Discord client ID",
    section: "presence",
    effect: "after-save",
    privacy: "sensitive",
    editable: true,
    envOverride: "KUNAI_DISCORD_CLIENT_ID",
  },
  {
    key: "presenceDiscordOpenUrl",
    label: "Discord open URL",
    section: "presence",
    effect: "after-save",
    privacy: "sensitive",
    editable: true,
  },
  {
    key: "providerPriority",
    label: "Series provider priority",
    section: "providers",
    effect: "after-save",
    privacy: "local",
    editable: true,
  },
  {
    key: "animeProviderPriority",
    label: "Anime provider priority",
    section: "providers",
    effect: "after-save",
    privacy: "local",
    editable: true,
  },
  {
    key: "videasySessionToken",
    label: "Videasy session token",
    section: "providers",
    effect: "next-resolve",
    privacy: "sensitive",
    editable: true,
    envOverride: "KUNAI_VIDEASY_SESSION_TOKEN",
  },
  {
    key: "videasySessionExpiresAt",
    label: "Videasy session expires",
    section: "providers",
    effect: "next-resolve",
    privacy: "sensitive",
    editable: false,
  },
  {
    key: "videasyAppId",
    label: "Videasy app id",
    section: "providers",
    effect: "next-resolve",
    privacy: "local",
    editable: false,
    options: ["bc-frontend", "vidking"],
  },
  {
    key: "updateChecksEnabled",
    label: "Update checks",
    section: "updates",
    effect: "after-save",
    privacy: "local",
    editable: true,
    options: ["on", "off"],
  },
] as const satisfies readonly ConfigMetadataEntry[];

export function getConfigMetadata<K extends (typeof CONFIG_METADATA)[number]["key"]>(
  key: K,
): Extract<(typeof CONFIG_METADATA)[number], { readonly key: K }> {
  const entry = CONFIG_METADATA.find((candidate) => candidate.key === key);
  if (!entry) {
    throw new Error(`Unknown config metadata key: ${String(key)}`);
  }
  return entry as Extract<(typeof CONFIG_METADATA)[number], { readonly key: K }>;
}
