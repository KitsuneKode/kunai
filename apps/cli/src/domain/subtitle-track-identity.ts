/**
 * When two subtitle tracks are the same track.
 *
 * Providers re-sign one file with rotating tokens, so the query and hash are
 * dropped before URLs are compared. That alone would also fold tracks that
 * differ *only* by query, such as YouTube `timedtext?lang=en` and `?lang=fr`,
 * so the language must agree too. A track whose language cannot be told stays
 * distinct from every other URL: an extra entry is harmless, a lost language
 * is not.
 *
 * The inventory merge (`subtitle.ts`), the mpv attach dedupe and the download
 * sidecar all decide identity here, so they cannot disagree about it.
 */
type IdentifiableSubtitleTrack = { readonly url: string; readonly language?: string };

function stripSubtitleUrlQuery(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  }
}

function subtitleTrackLanguage(track: { readonly language?: string } | undefined) {
  return track?.language?.trim().toLowerCase() || undefined;
}

/** Equal keys mean the same track; an empty URL yields `undefined`. */
export function subtitleTrackKey(track: IdentifiableSubtitleTrack): string | undefined {
  const base = stripSubtitleUrlQuery(track.url);
  if (!base) return undefined;
  return `${base}\u0000${subtitleTrackLanguage(track) ?? `?${track.url.trim()}`}`;
}

/**
 * The inventory entry a bare subtitle URL refers to: an exact URL match, else
 * the one same-file entry, or several that agree on the language. Disagreeing
 * candidates are ambiguous and return `undefined` rather than a guess.
 */
export function findSubtitleInventoryTrack<T extends IdentifiableSubtitleTrack>(
  url: string,
  tracks: readonly T[] | undefined,
): T | undefined {
  const trimmed = url.trim();
  const exact = tracks?.find((track) => track.url.trim() === trimmed);
  if (exact) return exact;
  const base = stripSubtitleUrlQuery(url);
  const candidates = (tracks ?? []).filter((track) => stripSubtitleUrlQuery(track.url) === base);
  const languages = new Set(candidates.map(subtitleTrackLanguage));
  return languages.size === 1 ? candidates[0] : undefined;
}
