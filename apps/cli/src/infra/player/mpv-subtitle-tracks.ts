import { findSubtitleInventoryTrack, subtitleTrackKey } from "@/domain/subtitle-track-identity";
import type { SubtitleTrack } from "@/domain/types";
import { dbg } from "@/logger";

import { isLocalSubtitlePath, type MpvUrlKind } from "./mpv-playback-url";

export function collectAdditionalSubtitleTracks(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): SubtitleTrack[] {
  const collected: SubtitleTrack[] = [];
  const seen = new Set<string>();
  if (primarySubtitle) {
    const match = findSubtitleInventoryTrack(primarySubtitle, subtitleTracks);
    const key = subtitleTrackKey({ url: primarySubtitle, language: match?.language });
    if (key) seen.add(key);
  }
  for (const track of subtitleTracks ?? []) {
    const key = subtitleTrackKey(track);
    if (!key || seen.has(key)) {
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
  const match = findSubtitleInventoryTrack(url, subtitleTracks);
  const language = match?.language?.trim() ?? "";
  const title =
    match?.display?.trim() ||
    [language || null, match?.sourceName?.trim() || null, match?.sourceKind || null]
      .filter((part): part is string => Boolean(part))
      .join(" ");
  return { title, language };
}

/** IPC commands whose timeout is a subtitle problem, not a dead player. */
export function isSubtitleIpcCommand(command: string): boolean {
  return command === "sub-add" || command === "sub-remove" || command === "sub-reload";
}
