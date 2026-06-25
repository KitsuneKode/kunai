import type { BrowseShellOption } from "@/app-shell/types";
import { isCalendarSearchResult } from "@/app/search/calendar-results";
import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { ListService } from "@/domain/lists/ListService";
import type { SearchResult, TitleAliasKind } from "@/domain/types";
import type { ResultEnrichment } from "@/services/catalog/ResultEnrichmentService";
import {
  formatTimestamp,
  historyContentType,
  isFinished,
} from "@/services/continuation/history-progress";
import type { FollowedTitlePreference, HistoryProgress } from "@kunai/storage";

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

function kindLabel(kind: CalendarItem["contentKind"]): string {
  return kind === "anime" ? "Anime" : kind === "movie" ? "Movie" : "Series";
}

function toCalendarBrowseOption(
  result: SearchResult,
  listService?: ListService,
): BrowseShellOption<SearchResult> {
  const calendar = result.calendar;
  const inWatchlist = calendar?.inWatchlist ?? listService?.isInWatchlist(result.id) ?? false;
  const posterUrl = toPosterUrl(result.posterPath);
  return {
    value: result,
    label: result.title,
    detail: result.overview?.trim() ?? "",
    calendar,
    previewTitle: result.title,
    previewMeta: [
      calendar ? kindLabel(calendar.contentKind) : result.type === "series" ? "Series" : "Movie",
      result.year || undefined,
      calendar?.display.time ?? undefined,
      formatRating(result.rating),
    ].filter((value): value is string => Boolean(value)),
    previewDayKey: calendar?.dayKey ?? undefined,
    previewTime: calendar?.display.time ?? undefined,
    previewBadge: inWatchlist ? "wl" : calendar?.display.badge,
    previewFacts: [
      {
        label: "Release",
        detail: calendar?.display.statusLabel || result.overview || "Schedule details unavailable",
        tone: "info" as const,
      },
    ],
    previewImageUrl: posterUrl,
    previewRating: formatRating(result.rating),
    previewBody: result.overview || "No schedule details available.",
    previewNote: "Press Enter to open this release.",
  };
}

function buildHistoryBadge(entry: HistoryProgress | null | undefined): string | undefined {
  if (!entry) return undefined;
  const ep =
    historyContentType(entry) === "series"
      ? `S${String(entry.season ?? 1).padStart(2, "0")}E${String(entry.episode ?? entry.absoluteEpisode ?? 1).padStart(2, "0")}`
      : null;
  if (isFinished(entry)) {
    return ep ? `Watched · ${ep}` : "Watched";
  }
  const ts = entry.positionSeconds > 10 ? formatTimestamp(entry.positionSeconds) : null;
  if (ep && ts) return `Resume · ${ep} · ${ts}`;
  if (ep) return `Started · ${ep}`;
  return "In progress";
}

export type BrowseResultOptionContext = {
  readonly followPreference?: FollowedTitlePreference;
  readonly inUpNextQueue?: boolean;
};

export function toBrowseResultOption(
  result: SearchResult,
  historyEntry?: HistoryProgress | null,
  titlePreference: TitleAliasKind | "provider" = "provider",
  enrichment?: ResultEnrichment | null,
  listService?: ListService,
  optionContext?: BrowseResultOptionContext,
): BrowseShellOption<SearchResult> {
  if (isCalendarSearchResult(result)) {
    return toCalendarBrowseOption(result, listService);
  }

  const historyBadge = buildHistoryBadge(historyEntry);
  const enrichmentBadges = enrichment?.badges ?? [];
  const inWatchlist = listService?.isInWatchlist(result.id) ?? false;
  const isFollowing = optionContext?.followPreference === "following";
  const displayTitle = chooseSearchResultTitle(result, titlePreference);
  const alternateTitles = formatAlternateTitles(result, displayTitle);
  const overview = normalizeProviderText(result.overview);
  const meta = [
    result.isAnime ? "Anime" : result.type === "series" ? "Series" : "Movie",
    result.year || undefined,
    result.episodeCount ? `${result.episodeCount} episodes` : undefined,
    formatAnimeAvailability(result),
    formatRating(result.rating),
    ...enrichmentBadges.map((badge) => badge.label),
    inWatchlist ? "[wl]" : undefined,
    historyBadge,
  ].filter((value): value is string => Boolean(value));
  const posterUrl = toPosterUrl(result.posterPath);
  const localStatus = enrichmentBadges.map((badge) => badge.label).join(" · ");

  return {
    value: result,
    label: result.year ? `${displayTitle} (${result.year})` : displayTitle,
    detail: `${result.type === "series" ? "Series" : "Movie"}${
      localStatus ? ` · ${localStatus}` : ""
    }${historyBadge ? ` · ${historyBadge}` : ""}${overview ? ` · ${overview}` : ""}`,
    previewTitle: displayTitle,
    previewMeta: meta,
    previewBadge: inWatchlist ? "wl" : isFollowing ? "★ following" : undefined,
    previewFacts: [
      ...buildLocalEnrichmentFacts(enrichment),
      ...buildManagementFacts(result, listService, optionContext),
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
        detail: overview ? "Overview available" : "Provider did not return overview text",
        tone: overview ? ("success" as const) : ("warning" as const),
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
    previewBody: overview || "No overview available yet.",
    previewNote:
      result.type === "series"
        ? "Press Enter to open this title and continue to episode selection. Use / details for the overview."
        : "Press Enter to open this title and continue to playback. Use / details for the overview.",
  };
}

function normalizeProviderText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return decodeHtmlEntities(trimmed.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function buildManagementFacts(
  result: SearchResult,
  listService?: ListService,
  optionContext?: BrowseResultOptionContext,
): NonNullable<BrowseShellOption<SearchResult>["previewFacts"]> {
  const facts: Array<NonNullable<BrowseShellOption<SearchResult>["previewFacts"]>[number]> = [];
  const inWatchlist = listService?.isInWatchlist(result.id) ?? false;
  facts.push({
    label: "Watchlist",
    detail: inWatchlist ? "On watchlist · /bookmark to remove" : "Not saved · /bookmark to add",
    tone: inWatchlist ? "success" : "neutral",
  });

  const followPreference = optionContext?.followPreference;
  if (followPreference === "following") {
    facts.push({
      label: "Release follow",
      detail: "Following releases · /follow or /mute to change",
      tone: "success",
    });
  } else if (followPreference === "muted") {
    facts.push({
      label: "Release follow",
      detail: "Muted · new-episode nudges suppressed · /follow to resume",
      tone: "warning",
    });
  } else if (inWatchlist) {
    facts.push({
      label: "Release follow",
      detail: "Not following releases · /follow to track new episodes",
      tone: "neutral",
    });
  }

  if (optionContext?.inUpNextQueue) {
    facts.push({
      label: "Up Next Queue",
      detail: "Queued for playback · /playlist to review order",
      tone: "info",
    });
  }

  return facts;
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

export function describeSearchResultAvailability(result: SearchResult): string {
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

function formatAnimeAvailability(result: SearchResult): string | undefined {
  if (result.type !== "series") return undefined;
  const audio = result.availableAudioModes?.length
    ? `${result.availableAudioModes.join("/")} audio`
    : "audio unknown";
  const subtitles =
    result.subtitleAvailability === "hardsub"
      ? "hardsub available"
      : result.subtitleAvailability === "softsub"
        ? "soft subs available"
        : "subs unknown";
  return `${audio} · ${subtitles}`;
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
