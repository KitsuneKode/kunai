import type { KunaiDatabase } from "@kunai/storage";

export interface DailyActivity {
  readonly date: string;
  readonly watchedCount: number;
  readonly totalSeconds: number;
}

export interface ShowStat {
  readonly titleId: string;
  readonly title: string;
  readonly episodeCount: number;
  readonly totalSeconds: number;
}

export interface TypeBreakdown {
  readonly animeSeconds: number;
  readonly seriesSeconds: number;
  readonly movieSeconds: number;
}

export interface DailyKindMix {
  readonly date: string;
  readonly animeSeconds: number;
  readonly seriesSeconds: number;
  readonly movieSeconds: number;
}

export interface WatchStats {
  readonly streakDays: number;
  readonly longestStreak: number;
  readonly totalEpisodes: number;
  readonly totalSeconds: number;
  readonly avgEpisodesPerDay: number;
  readonly activeDays: number;
  readonly mostActiveDay: string | null;
  readonly typeBreakdown: TypeBreakdown;
  readonly dailyKindMix: readonly DailyKindMix[];
  readonly heatmap: readonly DailyActivity[];
  readonly topShows: readonly ShowStat[];
  readonly weeklyBuckets: readonly DailyActivity[];
}

interface DayRow {
  readonly date: string;
  readonly watched_count: number;
  readonly total_seconds: number;
}

interface ShowRow {
  readonly title_id: string;
  readonly title: string;
  readonly episode_count: number;
  readonly total_seconds: number;
}

export class StatsService {
  constructor(private readonly db: KunaiDatabase) {}

  computeStreak(mediaKind?: "movie" | "series" | "anime"): { current: number; longest: number } {
    const kindClause = mediaKind ? ` AND media_kind = '${mediaKind}'` : "";
    const rows = this.db
      .query<{ date: string }, []>(
        `SELECT DISTINCT date(updated_at) AS date
         FROM history_progress
         WHERE (completed = 1 OR position_seconds >= 300)${kindClause}
         ORDER BY date DESC`,
      )
      .all();

    if (rows.length === 0) return { current: 0, longest: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    let current = 0;
    let longest = 0;
    let streak = 0;
    let prevDate: string | undefined;

    for (const { date } of rows) {
      if (streak === 0) {
        if (date === today || date === yesterday) {
          streak = 1;
          prevDate = date;
        } else {
          break;
        }
      } else {
        const prev = new Date(prevDate as string);
        const curr = new Date(date);
        const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000);
        if (diffDays === 1) {
          streak++;
          prevDate = date;
        } else {
          break;
        }
      }
    }
    current = streak;

    streak = 0;
    prevDate = undefined;
    for (const { date } of [...rows].reverse()) {
      if (prevDate === undefined) {
        streak = 1;
        prevDate = date;
      } else {
        const prev = new Date(prevDate);
        const curr = new Date(date);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        if (diffDays === 1) {
          streak++;
          prevDate = date;
        } else {
          longest = Math.max(longest, streak);
          streak = 1;
          prevDate = date;
        }
      }
    }
    longest = Math.max(longest, streak);

    return { current, longest };
  }

  getStats(windowDays = 30, mediaKind?: "movie" | "series" | "anime"): WatchStats {
    const { current: streakDays, longest: longestStreak } = this.computeStreak(mediaKind);

    const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString();
    const kindClause = mediaKind ? ` AND media_kind = '${mediaKind}'` : "";

    const totalsRow = this.db
      .query<{ total_episodes: number; total_seconds: number }, [string]>(
        `SELECT COUNT(*) AS total_episodes,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= ?${kindClause}`,
      )
      .get(windowStart) ?? { total_episodes: 0, total_seconds: 0 };

    const dayRows = this.db
      .query<DayRow, [string]>(
        `SELECT date(updated_at) AS date,
                COUNT(*) AS watched_count,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= ?${kindClause}
         GROUP BY date(updated_at)
         ORDER BY date ASC`,
      )
      .all(windowStart);

    const heatmapStart = new Date(Date.now() - 365 * 86400000).toISOString();
    const heatmapRows = this.db
      .query<DayRow, [string]>(
        `SELECT date(updated_at) AS date,
                COUNT(*) AS watched_count,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= ?${kindClause}
         GROUP BY date(updated_at)
         ORDER BY date ASC`,
      )
      .all(heatmapStart);

    const showRows = this.db
      .query<ShowRow, [string]>(
        `SELECT title_id,
                MAX(title) AS title,
                COUNT(*) AS episode_count,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= ?${kindClause}
         GROUP BY title_id
         ORDER BY total_seconds DESC
         LIMIT 10`,
      )
      .all(windowStart);

    const weeklyRows = this.db
      .query<{ week: string; watched_count: number; total_seconds: number }, [string]>(
        `SELECT strftime('%Y-W%W', updated_at) AS week,
                COUNT(*) AS watched_count,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= date('now', '-84 days')${kindClause}
         GROUP BY week
         ORDER BY week ASC`,
      )
      .all(windowStart);

    const activeDays = dayRows.length;
    const avgEpisodesPerDay =
      activeDays > 0 ? totalsRow.total_episodes / Math.max(1, windowDays) : 0;

    const mostActiveDay =
      dayRows.length > 0
        ? dayRows.reduce((best, row) => (row.total_seconds > best.total_seconds ? row : best)).date
        : null;

    const kindRows = this.db
      .query<{ media_kind: string; total_seconds: number }, [string]>(
        `SELECT media_kind,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= ?${kindClause}
         GROUP BY media_kind`,
      )
      .all(windowStart);

    let animeSeconds = 0;
    let seriesSeconds = 0;
    let movieSeconds = 0;
    for (const row of kindRows) {
      if (row.media_kind === "anime") animeSeconds = row.total_seconds;
      else if (row.media_kind === "series") seriesSeconds = row.total_seconds;
      else if (row.media_kind === "movie") movieSeconds = row.total_seconds;
    }
    const typeBreakdown: TypeBreakdown = { animeSeconds, seriesSeconds, movieSeconds };

    const dailyKindRows = this.db
      .query<{ date: string; media_kind: string; total_seconds: number }, [string]>(
        `SELECT date(updated_at) AS date,
                media_kind,
                COALESCE(SUM(COALESCE(duration_seconds, position_seconds)), 0) AS total_seconds
         FROM history_progress
         WHERE updated_at >= ?${kindClause}
         GROUP BY date(updated_at), media_kind
         ORDER BY date ASC`,
      )
      .all(heatmapStart);

    const dailyKindByDate = new Map<string, DailyKindMix>();
    for (const row of dailyKindRows) {
      const existing = dailyKindByDate.get(row.date) ?? {
        date: row.date,
        animeSeconds: 0,
        seriesSeconds: 0,
        movieSeconds: 0,
      };
      const next: DailyKindMix = {
        date: row.date,
        animeSeconds: existing.animeSeconds + (row.media_kind === "anime" ? row.total_seconds : 0),
        seriesSeconds:
          existing.seriesSeconds + (row.media_kind === "series" ? row.total_seconds : 0),
        movieSeconds: existing.movieSeconds + (row.media_kind === "movie" ? row.total_seconds : 0),
      };
      dailyKindByDate.set(row.date, next);
    }

    return {
      streakDays,
      longestStreak,
      totalEpisodes: totalsRow.total_episodes,
      totalSeconds: totalsRow.total_seconds,
      avgEpisodesPerDay: Math.round(avgEpisodesPerDay * 10) / 10,
      activeDays,
      mostActiveDay,
      typeBreakdown,
      dailyKindMix: [...dailyKindByDate.values()],
      heatmap: heatmapRows.map((r) => ({
        date: r.date,
        watchedCount: r.watched_count,
        totalSeconds: r.total_seconds,
      })),
      topShows: showRows.map((r) => ({
        titleId: r.title_id,
        title: r.title,
        episodeCount: r.episode_count,
        totalSeconds: r.total_seconds,
      })),
      weeklyBuckets: weeklyRows.map((r) => ({
        date: r.week,
        watchedCount: r.watched_count,
        totalSeconds: r.total_seconds,
      })),
    };
  }

  watchedToday(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM history_progress
         WHERE date(updated_at) = ? AND (completed = 1 OR position_seconds >= 300)`,
      )
      .get(today);
    return (row?.count ?? 0) > 0;
  }
}
