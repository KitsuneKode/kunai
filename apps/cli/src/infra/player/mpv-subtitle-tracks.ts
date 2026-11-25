import type { SubtitleTrack } from "@/domain/types";
import { dbg } from "@/logger";
import { normalizeSubtitleUrl } from "@/subtitle";

import { isLocalSubtitlePath, type MpvUrlKind } from "./mpv-playback-url";

/**
 * Two subtitle URLs are the same track when they match after dropping the
 * query and hash (providers re-sign one file with rotating tokens) **and**
 * their language agrees. The language check keeps query-distinct tracks such
 * as `timedtext?lang=en` and `?lang=fr` apart. When a URL's language cannot
 * be told, tracks stay separate: an extra attach is harmless, a lost
 * language is not.
 */
const languageOf = (track: SubtitleTrack | undefined) =>
  track?.language?.trim().toLowerCase() || undefined;

function inventoryMatch(
  url: string,
  subtitleTracks: readonly SubtitleTrack[] | undefined,
): SubtitleTrack | undefined {
  const trimmed = url.trim();
  const exact = subtitleTracks?.find((track) => track.url.trim() === trimmed);
  if (exact) return exact;
  const base = normalizeSubtitleUrl(url);
  const candidates = (subtitleTracks ?? []).filter(
    (track) => normalizeSubtitleUrl(track.url) === base,
  );
  const languages = new Set(candidates.map(languageOf));
  return languages.size === 1 ? candidates[0] : undefined;
}

const trackKey = (url: string, language: string | undefined) =>
  `${normalizeSubtitleUrl(url)}\u0000${language ?? `?${url.trim()}`}`;

export function collectAdditionalSubtitleTracks(
  primarySubtitle: string | null,
  subtitleTracks?: readonly SubtitleTrack[],
): SubtitleTrack[] {
  const collected: SubtitleTrack[] = [];
  const seen = new Set<string>();
  if (primarySubtitle) {
    seen.add(
      trackKey(primarySubtitle, languageOf(inventoryMatch(primarySubtitle, subtitleTracks))),
    );
  }
  for (const track of subtitleTracks ?? []) {
    const key = trackKey(track.url, languageOf(track));
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
  const match = inventoryMatch(url, subtitleTracks);
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
