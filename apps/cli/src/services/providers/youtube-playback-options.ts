import { buildYoutubeYtdlProfile, getYoutubeProviderConfig } from "@kunai/providers/youtube";
import type { StreamCandidate } from "@kunai/types";

export function resolveYoutubeYtdlRawOptions(selected: StreamCandidate): string | undefined {
  if (selected.protocol !== "youtube" && !selected.requiresYtdl) return undefined;
  const config = getYoutubeProviderConfig();
  const metadata = selected.metadata as
    | { readonly isLive?: boolean; readonly liveStatus?: string }
    | undefined;
  const isLive = metadata?.isLive === true || metadata?.liveStatus === "live";
  return buildYoutubeYtdlProfile({
    cookiesFromBrowser: config.cookiesFromBrowser,
    cookiesFile: config.cookiesFile,
    extractorArgs: config.extractorArgs,
    sponsorblockRemove: config.sponsorblockRemove,
    isLive,
    qualityLabel: selected.qualityLabel,
  }).mpvRawOptions;
}

export function resolveYtdlFormatFromCandidate(selected: StreamCandidate): string {
  const metadata = selected.metadata as { readonly ytdlFormat?: string } | undefined;
  if (typeof metadata?.ytdlFormat === "string" && metadata.ytdlFormat.trim()) {
    return metadata.ytdlFormat;
  }
  const config = getYoutubeProviderConfig();
  const liveMetadata = selected.metadata as
    | { readonly isLive?: boolean; readonly liveStatus?: string }
    | undefined;
  const isLive = liveMetadata?.isLive === true || liveMetadata?.liveStatus === "live";
  return buildYoutubeYtdlProfile({
    cookiesFromBrowser: config.cookiesFromBrowser,
    cookiesFile: config.cookiesFile,
    extractorArgs: config.extractorArgs,
    sponsorblockRemove: config.sponsorblockRemove,
    isLive,
    qualityLabel: selected.qualityLabel,
  }).mpvFormat;
}
