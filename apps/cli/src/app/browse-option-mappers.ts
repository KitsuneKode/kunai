import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult, TitleAliasKind } from "@/domain/types";
import type { ResultEnrichment } from "@/services/catalog/ResultEnrichmentService";
import {
  formatTimestamp,
  isFinished,
  type HistoryEntry,
} from "@/services/persistence/HistoryStore";

const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342";

function toPosterUrl(posterPath: string | null): string | undefined {
  if (!posterPath) return undefined;
  if (/^https?:\/\//i.test(posterPath)) return posterPath;
  return `${TMDB_POSTER_BASE_URL}${posterPath}`;
}

function formatRating(rating: number | null | undefined): string | undefined {
  if (typeof rating !== "number" || rating <= 0) return undefined;
  return `${rating.toFixed(1)}/10 TMDB`;
}

function buildHistoryBadge(entry: HistoryEntry | null | undefined): string | undefined {
  if (!entry) return undefined;
  const ep =
    entry.type === "series"
      ? `S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
      : null;
  if (isFinished(entry)) {
    return ep ? `Watched · ${ep}` : "Watched";
  }
  const ts = entry.timestamp > 10 ? formatTimestamp(entry.timestamp) : null;
  if (ep && ts) return `Resume · ${ep} · ${ts}`;
  if (ep) return `Started · ${ep}`;
  return "In progress";
}

export function toBrowseResultOption(
  result: SearchResult,
  historyEntry?: HistoryEntry | null,
  titlePreference: TitleAliasKind | "provider" = "provider",
  enrichment?: ResultEnrichment | null,
): BrowseShellOption<SearchResult> {
  const historyBadge = buildHistoryBadge(historyEntry);
  const enrichmentBadges = enrichment?.badges ?? [];
  const displayTitle = chooseSearchResultTitle(result, titlePreference);
  const alternateTitles = formatAlternateTitles(result, displayTitle);
  const meta = [
    result.type === "series" ? "Series" : "Movie",
    result.year || undefined,
    result.episodeCount ? `${result.episodeCount} episodes` : undefined,
    formatAnimeAvailability(result),
    formatRating(result.rating),
    ...enrichmentBadges.map((badge) => badge.label),
    historyBadge,
  ].filter((value): value is string => Boolean(value));
  const posterUrl = toPosterUrl(result.posterPath);
  const localStatus = enrichmentBadges.map((badge) => badge.label).join(" · ");

  return {
    value: result,
    label: result.year ? `${displayTitle} (${result.year})` : displayTitle,
    detail: `${result.type === "series" ? "Series" : "Movie"}${
      localStatus ? ` · ${localStatus}` : ""
    }${historyBadge ? ` · ${historyBadge}` : ""}${result.overview ? ` · ${result.overview}` : ""}`,
    previewTitle: displayTitle,
    previewMeta: meta,
    previewFacts: [
      ...buildLocalEnrichmentFacts(enrichment),
      ...(historyEntry
        ? [
            {
              label: "Watch history",
              detail: historyBadge ?? "Watched",
              tone: isFinished(historyEntry) ? ("success" as const) : ("neutral" as const),
            },
          ]
        : []),
      {
        label: "Metadata source",
        detail: result.metadataSource ?? "provider response",
        tone: result.metadataSource ? ("success" as const) : ("neutral" as const),
      },
      {
        label: "Title aliases",
        detail: alternateTitles || "No alternate title aliases returned",
        tone: alternateTitles ? ("success" as const) : ("neutral" as const),
      },
      {
        label: "Audio and subtitles",
        detail: describeSearchResultAvailability(result),
        tone:
          result.availableAudioModes?.length || result.subtitleAvailability
            ? ("success" as const)
            : ("neutral" as const),
      },
      {
        label: "Provider detail page",
        detail: result.overview ? "Overview available" : "Provider did not return overview text",
        tone: result.overview ? ("success" as const) : ("warning" as const),
      },
      {
        label: "Image source",
        detail: posterUrl
          ? `Poster URL available${result.posterSource ? ` from ${result.posterSource}` : ""}`
          : "No poster URL returned",
        tone: posterUrl ? ("success" as const) : ("warning" as const),
      },
      ...(typeof result.popularity === "number" && result.popularity > 0
        ? [
            {
              label: "Popularity",
              detail: result.popularity.toFixed(0),
              tone: "neutral" as const,
            },
          ]
        : []),
    ],
    previewImageUrl: posterUrl,
    previewRating: formatRating(result.rating),
    previewBody: result.overview || "No overview available yet.",
    previewNote:
      result.type === "series"
        ? "Press Enter to open this title and continue to episode selection. Use / details for the overview."
        : "Press Enter to open this title and continue to playback. Use / details for the overview.",
  };
}

function buildLocalEnrichmentFacts(
  enrichment: ResultEnrichment | null | undefined,
): NonNullable<BrowseShellOption<SearchResult>["previewFacts"]> {
  if (!enrichment?.badges.length) return [];
  return enrichment.badges.map((badge) => {
    const label =
      badge.label === "downloaded" || badge.label === "offline issue"
        ? "Offline"
        : "Local progress";
    return {
      label,
      detail: badge.label,
      tone: badge.tone,
    };
  });
}

function formatAnimeAvailability(result: SearchResult): string | undefined {
  if (result.type !== "series") return undefined;
  const audio = result.availableAudioModes?.length
    ? `${result.availableAudioModes.join("/")} audio`
    : null;
  const subtitles =
    result.subtitleAvailability === "hardsub"
      ? "hardsub available"
      : result.subtitleAvailability === "softsub"
        ? "soft subs available"
        : null;
  return [audio, subtitles].filter(Boolean).join(" · ") || undefined;
}

function describeSearchResultAvailability(result: SearchResult): string {
  const audio = result.availableAudioModes?.length
    ? `${result.availableAudioModes.join("/")} audio available`
    : "audio availability unknown until resolve";
  const subtitles =
    result.subtitleAvailability === "hardsub"
      ? "hardsub evidence from provider search"
      : result.subtitleAvailability === "softsub"
        ? "soft subtitle evidence from provider search"
        : "subtitle availability unknown until resolve";
  return `${audio}  ·  ${subtitles}`;
}

export function chooseSearchResultTitle(
  result: SearchResult,
  preference: TitleAliasKind | "provider" = "provider",
): string {
  if (preference === "provider") return result.title;
  const preferred = result.titleAliases?.find((alias) => alias.kind === preference)?.value;
  return preferred || result.title;
}

function formatAlternateTitles(result: SearchResult, displayTitle: string): string {
  const aliases = (result.titleAliases ?? [])
    .filter((alias) => alias.value !== displayTitle)
    .map((alias) => `${alias.kind}: ${alias.value}`);
  return aliases.slice(0, 3).join("  ·  ");
}
