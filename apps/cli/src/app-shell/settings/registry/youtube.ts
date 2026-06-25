import type { SettingRowDef, SettingsRegistryContext } from "../types";

function readYoutubeMetadata(
  config: SettingsRegistryContext["config"],
): NonNullable<SettingsRegistryContext["config"]["youtubeMetadata"]> {
  return config.youtubeMetadata ?? {};
}

function mergeYoutubeField(
  config: SettingsRegistryContext["config"],
  field: keyof NonNullable<SettingsRegistryContext["config"]["youtubeMetadata"]>,
  value: string,
): SettingsRegistryContext["config"] {
  const prev = readYoutubeMetadata(config);
  const trimmed = value.trim();
  const next = { ...prev };
  if (trimmed) {
    Object.assign(next, { [field]: trimmed });
  } else {
    delete next[field];
  }
  return { ...config, youtubeMetadata: next };
}

export function youtubeSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:youtube",
      label: "YouTube",
      detail: "Metadata search, cookies, and SponsorBlock for the YouTube provider lane",
      configKeys: ["youtubeMetadata"],
    },
    {
      kind: "text",
      id: "youtubeMetadataInstanceUrl",
      label: "Invidious instance",
      detail:
        "Custom Invidious base URL for search/browse metadata (leave empty for auto rotation)",
      placeholder: "https://yewtu.be",
      read: (config) => readYoutubeMetadata(config).instanceUrl?.trim() ?? "",
      apply: (config, value) => mergeYoutubeField(config, "instanceUrl", value),
      validate: () => null,
    },
    {
      kind: "text",
      id: "youtubeMetadataPipedApiUrl",
      label: "Piped API URL",
      detail: "Fallback metadata API when Invidious is unavailable",
      placeholder: "https://pipedapi.kavin.rocks",
      read: (config) => readYoutubeMetadata(config).pipedApiUrl?.trim() ?? "",
      apply: (config, value) => mergeYoutubeField(config, "pipedApiUrl", value),
      validate: () => null,
    },
    {
      kind: "text",
      id: "youtubeMetadataCookiesFromBrowser",
      label: "Cookies from browser",
      detail: "Browser profile for yt-dlp cookies (e.g. chrome, firefox) — age-restricted videos",
      placeholder: "chrome",
      sensitive: true,
      read: (config) => readYoutubeMetadata(config).cookiesFromBrowser?.trim() ?? "",
      apply: (config, value) => mergeYoutubeField(config, "cookiesFromBrowser", value),
      validate: () => null,
    },
    {
      kind: "text",
      id: "youtubeMetadataCookiesFile",
      label: "Cookies file",
      detail: "Netscape cookies.txt path for yt-dlp",
      placeholder: "/path/to/cookies.txt",
      sensitive: true,
      read: (config) => readYoutubeMetadata(config).cookiesFile?.trim() ?? "",
      apply: (config, value) => mergeYoutubeField(config, "cookiesFile", value),
      validate: () => null,
    },
    {
      kind: "text",
      id: "youtubeMetadataExtractorArgs",
      label: "Extractor args",
      detail: "Extra yt-dlp --extractor-args value for YouTube",
      placeholder: "youtube:player_client=android",
      read: (config) => readYoutubeMetadata(config).extractorArgs?.trim() ?? "",
      apply: (config, value) => mergeYoutubeField(config, "extractorArgs", value),
      validate: () => null,
    },
    {
      kind: "text",
      id: "youtubeMetadataSponsorblockRemove",
      label: "SponsorBlock remove",
      detail: "Comma-separated categories to skip on play/download (e.g. sponsor,intro,outro)",
      placeholder: "sponsor,intro,outro",
      read: (config) => readYoutubeMetadata(config).sponsorblockRemove?.trim() ?? "",
      apply: (config, value) => mergeYoutubeField(config, "sponsorblockRemove", value),
      validate: () => null,
    },
  ];
}
