import { hardSubInventory, selectedHardSubLanguage } from "@/domain/subtitle-policy";
import type { StreamInfo } from "@/domain/types";

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
