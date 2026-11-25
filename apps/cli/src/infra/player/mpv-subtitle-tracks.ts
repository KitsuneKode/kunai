import type { SubtitleTrack } from "@/domain/types";
import { dbg } from "@/logger";
import { normalizeSubtitleUrl } from "@/subtitle";

import { isLocalSubtitlePath, type MpvUrlKind } from "./mpv-playback-url";

export function collectAdditionalSubtitleTracks(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): SubtitleTrack[] {
  const collected: SubtitleTrack[] = [];
  const seen = new Set<string>();
  if (primarySubtitle) {
    seen.add(normalizeSubtitleUrl(primarySubtitle));
  }
  for (const track of subtitleTracks ?? []) {
    const key = normalizeSubtitleUrl(track.url);
    if (!track.url || seen.has(key)) {
      continue;
    }
    seen.add(key);
    collected.push(track);
  }
  return collected;
}

export function collectLaunchSubtitleFiles(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): string[] {
  const files: string[] = [];
  if (primarySubtitle) {
    files.push(primarySubtitle);
  }
  for (const track of collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks)) {
    files.push(track.url);
  }
  return files;
}

export function allowedLaunchSubtitleFiles(opts: {
  subtitle: string | null;
  subtitleUrlKind?: MpvUrlKind;
  subtitleTracks?: readonly SubtitleTrack[];
  localSubtitlePaths?: ReadonlySet<string>;
}): string[] {
  return collectLaunchSubtitleFiles(opts.subtitle, opts.subtitleTracks).filter((file) => {
    const trusted =
      opts.localSubtitlePaths?.has(file) ||
      (file === opts.subtitle && opts.subtitleUrlKind === "local");
    if (trusted && isLocalSubtitlePath(file)) return true;
    dbg("mpv", "subtitle-target-rejected", { delivery: "launch" });
    return false;
  });
}

export function describeSubtitleTrackForMpv(
  url: string,
  subtitleTracks?: readonly SubtitleTrack[],
) {
  const key = normalizeSubtitleUrl(url);
  const match = subtitleTracks?.find((track) => normalizeSubtitleUrl(track.url) === key);
  const language = match?.language?.trim() ?? "";
  const title =
    match?.display?.trim() ||
    [language || null, match?.sourceName?.trim() || null, match?.sourceKind || null]
      .filter((part): part is string => Boolean(part))
      .join(" ");
  return { title, language };
}
