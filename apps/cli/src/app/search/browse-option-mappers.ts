import type { BrowseShellOption, ShellPanelLine } from "@/app-shell/types";
import { buildLocalFilterFacts } from "@/app/search/browse-local-filter-facts";
import { isCalendarSearchResult } from "@/app/search/calendar-results";
import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { ListService } from "@/domain/lists/ListService";
import { isAnimeContent } from "@/domain/media/content-kind";
import type { SearchResult, TitleAliasKind, YouTubeLiveStatus } from "@/domain/types";
import type { ResultEnrichment } from "@/services/catalog/ResultEnrichmentService";
import {
  formatTimestamp,
  historyContentType,
  isFinished,
} from "@/services/continuation/history-progress";
import {
  formatDurationSeconds,
  formatRelativeTime,
  formatViewCount,
} from "@kunai/providers/youtube";
import type { FollowedTitlePreference, HistoryProgress } from "@kunai/storage";

/**
 * The one place a YouTube live state becomes words. The row line, the preview badge
 * and the preview facts all showed the same status through their own ternary chain,
 * so they could drift apart on the same result.
 */
const YOUTUBE_LIVE_LABELS = {
  live: "\u25cf LIVE",
  upcoming: "Upcoming",
  post_live: "Was Live",
} as const;

function youtubeLiveLabel(status: YouTubeLiveStatus | undefined): string | undefined {
  return status && status !== "none" ? YOUTUBE_LIVE_LABELS[status] : undefined;
}

/**
 * The YouTube-only rows of the preview pane, in display order. These were five
 * near-identical conditional spreads; one builder keeps the shape, the ordering,
 * and the empty handling in a single place.
 */
function youtubePreviewFacts(result: SearchResult, contentLabel: string): ShellPanelLine[] {
  const facts: ShellPanelLine[] = [];
  const push = (
    label: string,
    detail: string | undefined,
    tone: ShellPanelLine["tone"] = "neutral",
  ) => {
    if (detail) facts.push({ label, detail, tone });
  };
  const clock = result.durationSeconds
    ? (formatDurationSeconds(result.durationSeconds) ?? `${result.durationSeconds}s`)
    : undefined;

  push("Channel", result.channelTitle);
  push(
    "Views",
    result.viewCount === undefined
      ? undefined
      : (formatViewCount(result.viewCount) ?? `${result.viewCount}`),
  );
  push(
    "Uploaded",
    result.publishedAt ? (formatRelativeTime(result.publishedAt) ?? result.publishedAt) : undefined,
  );
  push("Duration", clock && contentLabel === "Short" ? `Short (${clock})` : clock);
  push(
    "Live status",
    youtubeLiveLabel(result.liveStatus),
    result.liveStatus === "live"
      ? "error"
      : result.liveStatus === "upcoming"
        ? "warning"
        : "neutral",
  );
  return facts;
}

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
    localFilterFacts: buildLocalFilterFacts({
      result,
      calendar,
    }),
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
  const isYoutubeResult =
    result.contentShape !== undefined ||
    result.externalIds?.youtubeId !== undefined ||
    result.id.startsWith("youtube:");
  const contentLabel = isYoutubeResult
    ? result.contentShape === "playlist"
      ? "Playlist"
      : result.contentShape === "channel"
        ? "Channel"
        : result.contentShape === "short"
          ? "Short"
          : "Video"
    : isAnimeContent(result)
      ? "Anime"
      : result.type === "series"
        ? "Series"
        : "Movie";
  const meta = [
    contentLabel,
    isYoutubeResult ? undefined : result.year || undefined,
    formatDurationSeconds(result.durationSeconds),
    result.channelTitle,
    formatViewCount(result.viewCount),
    youtubeLiveLabel(result.liveStatus),
    result.episodeCount && (result.type !== "movie" || isYoutubeResult)
      ? result.contentShape === "channel" || result.contentShape === "playlist"
        ? `${result.episodeCount} videos`
        : `${result.episodeCount} episodes`
      : undefined,
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
    localFilterFacts: buildLocalFilterFacts({
      result,
      historyEntry,
      enrichmentBadges,
    }),
    label: isYoutubeResult
      ? displayTitle
      : result.year
        ? `${displayTitle} (${result.year})`
        : displayTitle,
    detail: `${contentLabel}${localStatus ? ` · ${localStatus}` : ""}${
      historyBadge ? ` · ${historyBadge}` : ""
    }${overview ? ` · ${overview}` : ""}`,
    previewTitle: displayTitle,
    previewMeta: meta,
    // Membership stays first. `previewBadge` is not free-form: calendar banding
    // (`isCalendarTrackedOption`), the calendar episode-code slot, and the preview
    // rail all exact-match "wl", so a live label in front would quietly drop a
    // watchlisted broadcast out of all three. Live state is carried by the meta line
    // and the preview facts, so nothing is lost by ranking it below.
    previewBadge: inWatchlist
      ? "wl"
      : isFollowing
        ? "★ following"
        : youtubeLiveLabel(result.liveStatus),
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
      ...(isYoutubeResult ? youtubePreviewFacts(result, contentLabel) : []),
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
      isYoutubeResult && result.liveStatus === "upcoming"
        ? "This YouTube premiere has not started yet."
        : isYoutubeResult && result.liveStatus === "live"
          ? "This stream is live. Press Enter to join at the live edge."
          : isYoutubeResult && result.contentShape === "playlist"
            ? "Press Enter to open this playlist and choose a video."
            : isYoutubeResult && result.contentShape === "channel"
              ? "Press Enter to open this channel and choose a video."
              : isYoutubeResult && result.contentShape === "short"
                ? "Press Enter to open this Short and continue to playback."
                : isYoutubeResult
                  ? "Press Enter to open this video and continue to playback."
                  : result.type === "series"
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

  // Favourite state belongs beside watchlist state: the row marker says *that*
  // a title is favourited, and this says what to press to change it. Without
  // it the panel described one half of the same pair of lists.
  const inFavorites = listService?.isInFavorites(result.id) ?? false;
  facts.push({
    label: "Favourite",
    detail: inFavorites ? "♥ Favourited · f to remove" : "Not favourited · f to add",
    tone: inFavorites ? "success" : "neutral",
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
      label: "Up Next",
      detail: "Queued for playback · /up-next to review order",
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
