export type CalendarContentKind = "anime" | "series" | "movie";
export type CalendarReleasePrecision = "timestamp" | "date" | "unknown";
export type CalendarReleaseStatus = "released" | "upcoming" | "unknown";
export type CalendarContinuationState =
  | "resume"
  | "next-up"
  | "offline-ready"
  | "new-episodes"
  | "new-season"
  | "airing-weekly"
  | "up-to-date"
  | "empty";

// Domain-facing input contract for the builder. `CatalogScheduleItem` (a service
// type) is a structural superset, so callers pass it directly — this keeps the
// domain layer free of any service/infra import.
export type CalendarScheduleInput = {
  readonly source: "anilist" | "tmdb";
  readonly titleId: string;
  readonly titleName: string;
  readonly type: CalendarContentKind;
  readonly season?: number;
  readonly episode?: number;
  readonly episodeTitle?: string;
  readonly releaseAt: string | null;
  readonly releasePrecision: CalendarReleasePrecision;
  readonly status: CalendarReleaseStatus;
  readonly posterPath?: string | null;
  readonly popularity?: number;
  readonly averageScore?: number;
};
export type CalendarReleaseReason =
  | "airing-today"
  | "upcoming-episode"
  | "movie-release"
  | "provider-confirmed"
  | "catalog-only";

export type CalendarItem = {
  readonly source: "anilist" | "tmdb";
  readonly titleId: string;
  readonly title: string;
  readonly contentKind: CalendarContentKind;
  readonly season?: number;
  readonly episode?: number;
  readonly episodeTitle?: string;
  readonly releaseAt: string | null;
  readonly releasePrecision: CalendarReleasePrecision;
  readonly releaseStatus: CalendarReleaseStatus;
  readonly providerConfirmed: boolean;
  readonly reason: CalendarReleaseReason;
  readonly dayKey: string | null;
  readonly poster?: string | null;
  readonly popularity?: number;
  readonly averageScore?: number;
  readonly newEpisodeCount?: number;
  readonly inWatchlist?: boolean;
  readonly inHistory?: boolean;
  readonly continuation?: {
    readonly state: CalendarContinuationState;
    readonly badge?: string;
    readonly playable: boolean;
    readonly targetTitleId?: string;
    readonly season?: number;
    readonly episode?: number;
  };
  readonly display: {
    readonly time: string | null;
    readonly statusLabel: string;
    readonly episodeCode: string;
    readonly badge?: string;
    readonly groupLabel: string;
  };
};

export type CalendarItemContext = {
  readonly nowMs: number;
  readonly inWatchlist?: boolean;
  readonly inHistory?: boolean;
  readonly newEpisodeCount?: number;
  readonly providerConfirmed?: boolean;
  readonly continuation?: CalendarItem["continuation"];
};

export function buildCalendarItem(
  item: CalendarScheduleInput,
  ctx: CalendarItemContext,
): CalendarItem {
  const contentKind: CalendarContentKind =
    item.type === "movie" ? "movie" : item.type === "anime" ? "anime" : "series";
  const releaseStatus = item.status;
  const releasedToday = isSameLocalDay(item.releaseAt, ctx.nowMs);
  // Unknown precision/date can never be provider-confirmed (spec invariant).
  const providerConfirmed =
    releaseStatus !== "unknown" && Boolean(ctx.providerConfirmed) && Boolean(item.releaseAt);
  const reason = classifyReason({ contentKind, releaseStatus, releasedToday, providerConfirmed });
  const episodeCode = formatEpisodeCode(item);
  const time = formatTime(item);
  const dayKey = formatDayKey(item.releaseAt);

  return {
    source: item.source,
    titleId: item.titleId,
    title: item.titleName,
    contentKind,
    season: item.season,
    episode: item.episode,
    episodeTitle: item.episodeTitle,
    releaseAt: item.releaseAt,
    releasePrecision: item.releasePrecision,
    releaseStatus,
    providerConfirmed,
    reason,
    dayKey,
    poster: item.posterPath ?? null,
    popularity: item.popularity,
    averageScore: item.averageScore,
    newEpisodeCount: ctx.newEpisodeCount,
    inWatchlist: ctx.inWatchlist,
    inHistory: ctx.inHistory,
    continuation: ctx.continuation,
    display: {
      time,
      statusLabel: formatStatusLabel({ item, reason, releaseStatus, releasedToday, time }),
      episodeCode,
      badge: formatBadge({ item, ctx, episodeCode }),
      groupLabel: formatGroupLabel(item.releaseAt, ctx.nowMs),
    },
  };
}

function classifyReason(input: {
  readonly contentKind: CalendarContentKind;
  readonly releaseStatus: CalendarReleaseStatus;
  readonly releasedToday: boolean;
  readonly providerConfirmed: boolean;
}): CalendarReleaseReason {
  if (input.releaseStatus === "unknown") return "catalog-only";
  if (input.providerConfirmed) return "provider-confirmed";
  if (input.contentKind === "movie") return "movie-release";
  if (input.releasedToday) return "airing-today";
  if (input.releaseStatus === "upcoming") return "upcoming-episode";
  return "catalog-only";
}

function formatEpisodeCode(item: CalendarScheduleInput): string {
  if (item.type === "movie") return "";
  if (typeof item.season === "number" && typeof item.episode === "number") {
    return `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  if (typeof item.episode === "number") return `E${String(item.episode).padStart(2, "0")}`;
  return "";
}

function formatTime(item: CalendarScheduleInput): string | null {
  if (!item.releaseAt || item.releasePrecision !== "timestamp") return null;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(item.releaseAt),
  );
}

function formatStatusLabel(input: {
  readonly item: CalendarScheduleInput;
  readonly reason: CalendarReleaseReason;
  readonly releaseStatus: CalendarReleaseStatus;
  readonly releasedToday: boolean;
  readonly time: string | null;
}): string {
  const { item, reason, releaseStatus, releasedToday, time } = input;
  if (releaseStatus === "unknown" || !item.releaseAt) return "release unknown";
  if (reason === "provider-confirmed") return "available";
  if (reason === "movie-release") return `releases ${formatShortDate(item.releaseAt)}`;
  if (releasedToday) {
    return releaseStatus === "released"
      ? time
        ? `released today · ${time}`
        : "new today"
      : time
        ? `airs today · ${time}`
        : "airs today";
  }
  if (releaseStatus === "released") return "available";
  return time
    ? `airs ${formatShortDate(item.releaseAt)} · ${time}`
    : `airs ${formatShortDate(item.releaseAt)}`;
}

function formatBadge(input: {
  readonly item: CalendarScheduleInput;
  readonly ctx: CalendarItemContext;
  readonly episodeCode: string;
}): string | undefined {
  const { item, ctx, episodeCode } = input;
  if (ctx.newEpisodeCount && ctx.newEpisodeCount > 0) return `${ctx.newEpisodeCount} new`;
  if (ctx.inWatchlist) return "wl";
  if (item.type !== "movie" && typeof item.episode === "number") {
    return episodeCode || `E${item.episode}`;
  }
  return undefined;
}

function formatGroupLabel(releaseAt: string | null, nowMs: number): string {
  if (!releaseAt) return "DATE TBA";
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return "DATE TBA";
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })
    .format(release)
    .toUpperCase();
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(release);
  const base = `${weekday} ${day}`;
  if (isSameLocalDay(releaseAt, nowMs)) return `${base} · Today`;
  const tomorrow = new Date(nowMs);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameLocalDay(releaseAt, tomorrow.getTime())) return `${base} · Tomorrow`;
  return base;
}

function formatShortDate(releaseAt: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(releaseAt),
  );
}

function formatDayKey(releaseAt: string | null): string | null {
  if (!releaseAt) return null;
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return null;
  const y = release.getFullYear();
  const m = String(release.getMonth() + 1).padStart(2, "0");
  const d = String(release.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameLocalDay(releaseAt: string | null, nowMs: number): boolean {
  if (!releaseAt) return false;
  const release = new Date(releaseAt);
  if (Number.isNaN(release.getTime())) return false;
  const now = new Date(nowMs);
  return (
    release.getFullYear() === now.getFullYear() &&
    release.getMonth() === now.getMonth() &&
    release.getDate() === now.getDate()
  );
}
