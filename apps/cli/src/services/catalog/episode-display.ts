import { isPlaceholderEpisodeName, truncateAtWord } from "@/domain/text-display";

export { isPlaceholderEpisodeName };

export function cleanEpisodeSynopsis(overview: string | undefined): string | undefined {
  const trimmed = overview?.trim() ?? "";
  if (!trimmed || /^(?:tba|untitled|n\/a|none)$/i.test(trimmed) || /^[\s.\-_·…]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\s+/g, " ");
}

export function formatEpisodeAirDate(airDate: string | undefined): string | undefined {
  const trimmed = airDate?.trim() ?? "";
  if (!trimmed) return undefined;
  const parsed = Date.parse(`${trimmed}T12:00:00`);
  if (!Number.isFinite(parsed)) return trimmed;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatEpisodePickerLabel(
  episodeNumber: number,
  name: string | undefined,
  overview?: string,
): string {
  if (!isPlaceholderEpisodeName(episodeNumber, name)) {
    const trimmed = name?.trim() ?? "";
    return `Episode ${episodeNumber}  ·  ${trimmed}`;
  }

  const synopsis = cleanEpisodeSynopsis(overview);
  if (synopsis) {
    return `Episode ${episodeNumber}  ·  ${truncateAtWord(synopsis, 52)}`;
  }
  return `Episode ${episodeNumber}`;
}

export function formatEpisodePickerDetail(input: {
  readonly airDate?: string;
  readonly overview?: string;
  readonly runtimeMinutes?: number;
}): string | undefined {
  const parts: string[] = [];
  const aired = formatEpisodeAirDate(input.airDate);
  if (aired) parts.push(aired);
  if (typeof input.runtimeMinutes === "number" && input.runtimeMinutes > 0) {
    parts.push(`${input.runtimeMinutes} min`);
  }
  const synopsis = cleanEpisodeSynopsis(input.overview);
  if (synopsis && parts.length === 0) {
    parts.push(truncateAtWord(synopsis, 72));
  }
  return parts.length > 0 ? parts.join("  ·  ") : undefined;
}

export function formatEpisodePreviewSynopsis(overview: string | undefined): string | undefined {
  const synopsis = cleanEpisodeSynopsis(overview);
  if (!synopsis) return undefined;
  return truncateAtWord(synopsis, 160);
}
