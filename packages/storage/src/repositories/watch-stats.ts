import type { KunaiDatabase } from "../sqlite";

export interface WatchStatsTotalsRow {
  readonly rowCount: number;
  readonly totalSeconds: number;
  readonly completedEpisodes: number;
  readonly seriesCompleted: number;
}

export interface WatchStatsDayRow {
  readonly date: string;
  readonly watchedCount: number;
  readonly totalSeconds: number;
}

export interface WatchStatsWeekRow {
  readonly week: string;
  readonly watchedCount: number;
  readonly totalSeconds: number;
}

export interface WatchStatsShowRow {
  readonly titleId: string;
  readonly title: string;
  readonly episodeCount: number;
  readonly totalSeconds: number;
}

export interface WatchStatsProviderRow {
  readonly providerId: string;
  readonly episodeCount: number;
  readonly totalSeconds: number;
}

export interface WatchStatsHourRow {
  readonly hour: number;
  readonly episodeCount: number;
  readonly totalSeconds: number;
}

export interface WatchStatsKindRow {
  readonly kind: string;
  readonly totalSeconds: number;
}

export interface WatchStatsDailyKindRow {
  readonly date: string;
  readonly kind: string;
  readonly totalSeconds: number;
}

export interface WatchStatsTitleSecondsRow {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: string;
  readonly externalIdsJson: string | null;
  readonly totalSeconds: number;
}

/** Mirrors correctedHistoryMediaKind — anime-only providers and AniList/MAL ids win. */
const ANIME_MATCH_SQL = `(
  provider_id IN ('allanime', 'miruro')
  OR json_extract(external_ids_json, '$.anilistId') IS NOT NULL
  OR json_extract(external_ids_json, '$.malId') IS NOT NULL
)`;

const CORRECTED_KIND_SQL = `CASE
  WHEN ${ANIME_MATCH_SQL} THEN 'anime'
  WHEN media_kind = 'anime' THEN 'series'
  ELSE media_kind
END`;

const ACTIVITY_TS = "COALESCE(last_watched_at, updated_at)";

/**
 * SQL aggregation for watch stats — shared by StatsService and future recommendation
 * affinity queries. Uses watched_seconds (engaged time) and completed for honesty.
 */
export class WatchStatsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  totalsSince(windowStartIso: string, mediaKind?: string): WatchStatsTotalsRow {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return (
      this.db
        .query<WatchStatsTotalsRow, string[]>(
          `
            WITH filtered AS (
              SELECT
                title_id,
                completed,
                watched_seconds,
                ${CORRECTED_KIND_SQL} AS corrected_kind
              FROM history_progress
              WHERE ${ACTIVITY_TS} >= ?${kindClause}
            )
            SELECT
              COUNT(*) AS rowCount,
              COALESCE(SUM(watched_seconds), 0) AS totalSeconds,
              COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS completedEpisodes,
              (
                SELECT COUNT(*) FROM (
                  SELECT title_id
                  FROM filtered
                  WHERE corrected_kind != 'movie'
                  GROUP BY title_id
                  HAVING MIN(completed) = 1 AND COUNT(*) > 0
                )
              ) AS seriesCompleted
            FROM filtered
          `,
        )
        .get(...params) ?? {
        rowCount: 0,
        totalSeconds: 0,
        completedEpisodes: 0,
        seriesCompleted: 0,
      }
    );
  }

  dailyActivitySince(windowStartIso: string, mediaKind?: string): readonly WatchStatsDayRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<{ date: string; watched_count: number; total_seconds: number }, typeof params>(
        `
          SELECT
            date(${ACTIVITY_TS}) AS date,
            COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS watched_count,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?${kindClause}
          GROUP BY date(${ACTIVITY_TS})
          ORDER BY date ASC
        `,
      )
      .all(...params)
      .map((row) => ({
        date: row.date,
        watchedCount: row.watched_count,
        totalSeconds: row.total_seconds,
      }));
  }

  weeklyBucketsSince(windowStartIso: string, mediaKind?: string): readonly WatchStatsWeekRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<{ week: string; watched_count: number; total_seconds: number }, typeof params>(
        `
          SELECT
            strftime('%Y-W%W', ${ACTIVITY_TS}) AS week,
            COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS watched_count,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?${kindClause}
          GROUP BY week
          ORDER BY week ASC
        `,
      )
      .all(...params)
      .map((row) => ({
        week: row.week,
        watchedCount: row.watched_count,
        totalSeconds: row.total_seconds,
      }));
  }

  kindBreakdownSince(windowStartIso: string, mediaKind?: string): readonly WatchStatsKindRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<{ kind: string; total_seconds: number }, typeof params>(
        `
          SELECT
            ${CORRECTED_KIND_SQL} AS kind,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?${kindClause}
          GROUP BY kind
        `,
      )
      .all(...params)
      .map((row) => ({
        kind: row.kind,
        totalSeconds: row.total_seconds,
      }));
  }

  dailyKindMixSince(windowStartIso: string, mediaKind?: string): readonly WatchStatsDailyKindRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<{ date: string; kind: string; total_seconds: number }, typeof params>(
        `
          SELECT
            date(${ACTIVITY_TS}) AS date,
            ${CORRECTED_KIND_SQL} AS kind,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?${kindClause}
          GROUP BY date(${ACTIVITY_TS}), kind
          ORDER BY date ASC
        `,
      )
      .all(...params)
      .map((row) => ({
        date: row.date,
        kind: row.kind,
        totalSeconds: row.total_seconds,
      }));
  }

  topShowsSince(
    windowStartIso: string,
    mediaKind?: string,
    limit = 10,
  ): readonly WatchStatsShowRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<
        { title_id: string; title: string; episode_count: number; total_seconds: number },
        [...typeof params, number]
      >(
        `
          SELECT
            title_id,
            MAX(title) AS title,
            COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS episode_count,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?${kindClause}
          GROUP BY title_id
          ORDER BY total_seconds DESC
          LIMIT ?
        `,
      )
      .all(...params, limit)
      .map((row) => ({
        titleId: row.title_id,
        title: row.title,
        episodeCount: row.episode_count,
        totalSeconds: row.total_seconds,
      }));
  }

  providerBreakdownSince(
    windowStartIso: string,
    mediaKind?: string,
  ): readonly WatchStatsProviderRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<{ provider_id: string; episode_count: number; total_seconds: number }, typeof params>(
        `
          SELECT
            provider_id,
            COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS episode_count,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?
            AND provider_id IS NOT NULL
            AND provider_id != ''${kindClause}
          GROUP BY provider_id
          ORDER BY total_seconds DESC
        `,
      )
      .all(...params)
      .map((row) => ({
        providerId: row.provider_id,
        episodeCount: row.episode_count,
        totalSeconds: row.total_seconds,
      }));
  }

  hourOfDaySince(windowStartIso: string, mediaKind?: string): readonly WatchStatsHourRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<{ hour: number; episode_count: number; total_seconds: number }, typeof params>(
        `
          SELECT
            CAST(strftime('%H', ${ACTIVITY_TS}) AS INTEGER) AS hour,
            COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) AS episode_count,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?${kindClause}
          GROUP BY hour
          ORDER BY hour ASC
        `,
      )
      .all(...params)
      .map((row) => ({
        hour: row.hour,
        episodeCount: row.episode_count,
        totalSeconds: row.total_seconds,
      }));
  }

  /**
   * Completed titles in the activity window with engaged seconds — for read-only genre affinity.
   */
  completedTitleWatchSecondsSince(
    windowStartIso: string,
    mediaKind?: string,
    limit = 50,
  ): readonly WatchStatsTitleSecondsRow[] {
    const { kindClause, params } = kindWhereClause(mediaKind, windowStartIso);
    return this.db
      .query<
        {
          title_id: string;
          title: string;
          media_kind: string;
          external_ids_json: string | null;
          total_seconds: number;
        },
        [...typeof params, number]
      >(
        `
          SELECT
            title_id,
            MAX(title) AS title,
            MAX(media_kind) AS media_kind,
            MAX(external_ids_json) AS external_ids_json,
            COALESCE(SUM(watched_seconds), 0) AS total_seconds
          FROM history_progress
          WHERE ${ACTIVITY_TS} >= ?
            AND completed = 1${kindClause}
          GROUP BY title_id
          ORDER BY total_seconds DESC
          LIMIT ?
        `,
      )
      .all(...params, limit)
      .map((row) => ({
        titleId: row.title_id,
        title: row.title,
        mediaKind: row.media_kind,
        externalIdsJson: row.external_ids_json,
        totalSeconds: row.total_seconds,
      }));
  }

  streakDates(mediaKind?: string): readonly string[] {
    const { kindClause, params } = streakKindWhereClause(mediaKind);
    return this.db
      .query<{ date: string }, string[]>(
        `
          SELECT DISTINCT date(${ACTIVITY_TS}) AS date
          FROM history_progress
          WHERE (completed = 1 OR position_seconds >= 300)${kindClause}
          ORDER BY date DESC
        `,
      )
      .all(...params)
      .map((row) => row.date);
  }
}

function kindWhereClause(
  mediaKind: string | undefined,
  windowStartIso: string,
): { kindClause: string; params: [string] | [string, string] } {
  if (!mediaKind) {
    return { kindClause: "", params: [windowStartIso] };
  }
  if (mediaKind === "anime") {
    return { kindClause: ` AND ${ANIME_MATCH_SQL}`, params: [windowStartIso] };
  }
  if (mediaKind === "series") {
    return {
      kindClause: ` AND NOT ${ANIME_MATCH_SQL} AND media_kind IN ('series', 'anime')`,
      params: [windowStartIso],
    };
  }
  if (mediaKind === "movie") {
    return { kindClause: " AND media_kind = 'movie'", params: [windowStartIso] };
  }
  return { kindClause: " AND media_kind = ?", params: [windowStartIso, mediaKind] };
}

function streakKindWhereClause(mediaKind: string | undefined): {
  kindClause: string;
  params: string[];
} {
  if (!mediaKind) {
    return { kindClause: "", params: [] };
  }
  if (mediaKind === "anime") {
    return { kindClause: ` AND ${ANIME_MATCH_SQL}`, params: [] };
  }
  if (mediaKind === "series") {
    return {
      kindClause: ` AND NOT ${ANIME_MATCH_SQL} AND media_kind IN ('series', 'anime')`,
      params: [],
    };
  }
  if (mediaKind === "movie") {
    return { kindClause: " AND media_kind = 'movie'", params: [] };
  }
  return { kindClause: " AND media_kind = ?", params: [mediaKind] };
}
