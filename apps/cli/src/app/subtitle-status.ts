import { hardSubInventory, selectedHardSubLanguage } from "@/domain/subtitle-policy";
import type { StreamInfo } from "@/domain/types";

export type PlaybackSubtitleStatusTone = "success" | "info" | "warning";

export function describePlaybackSubtitleStatus(
  stream: StreamInfo | null | undefined,
  subLang: string,
): string {
  if (subLang === "none") {
    return "subtitles disabled";
  }

  if (!stream) {
    return "subtitles not resolved yet";
  }

  if (stream.subtitle) {
    return "subtitle attached";
  }

  const selectedHardSub = selectedHardSubLanguage(stream);
  if (selectedHardSub) {
    return `hardsub ${selectedHardSub}`;
  }

  const hardSubLanguages = hardSubInventory(stream);
  if (hardSubLanguages.length > 0) {
    return `hardsub available ${hardSubLanguages.slice(0, 3).join("/")}`;
  }

  if (stream.subtitleList?.length) {
    return `${stream.subtitleList.length} subtitle tracks available`;
  }

  return "subtitles not found";
}

export function playbackSubtitleStatusTone(status: string): PlaybackSubtitleStatusTone {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("attached") ||
    normalized.startsWith("hardsub") ||
    normalized.includes("available")
  ) {
    return "success";
  }
  if (normalized.includes("not resolved")) return "info";
  return "warning";
}

export function compactPlaybackSubtitleStatus(status: string): string {
  if (status === "subtitle attached") return "subs ready";
  if (status === "subtitles disabled") return "subs off";
  if (status === "subtitles not found") return "subs missing";
  if (status.endsWith(" subtitle tracks available")) {
    return status.replace(" subtitle tracks available", " subs");
  }
  return status;
}
