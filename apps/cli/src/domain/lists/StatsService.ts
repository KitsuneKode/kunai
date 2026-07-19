import type { KunaiDatabase } from "@kunai/storage";
import { WatchStatsRepository } from "@kunai/storage";

import { buildWatchGenreBreakdown, type WatchGenreBreakdown } from "./WatchGenreStats";

/** Sentinel window length used by Stats UI for "All time". */
export const ALL_TIME_STATS_WINDOW_DAYS = 99_999;

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
  readonly videoSeconds: number;
}

export interface DailyKindMix {
  readonly date: string;
  readonly animeSeconds: number;
  readonly seriesSeconds: number;
  readonly movieSeconds: number;
  readonly videoSeconds: number;
}

export interface ProviderStat {
  readonly providerId: string;
  readonly episodeCount: number;
  readonly totalSeconds: number;
}

export interface HourOfDayStat {
  readonly hour: number;
  readonly episodeCount: number;
  readonly totalSeconds: number;
}

export interface GenreStat {
  readonly genreId: number;
  readonly label: string;
  readonly totalSeconds: number;
}

export interface WatchStats {
  readonly streakDays: number;
  readonly longestStreak: number;
  readonly totalEpisodes: number;
  readonly completedEpisodes: number;
  readonly completionRate: number;
  readonly seriesCompleted: number;
  readonly totalSeconds: number;
  readonly avgEpisodesPerDay: number;
  readonly activeDays: number;
  readonly mostActiveDay: string | null;
  readonly typeBreakdown: TypeBreakdown;
  readonly providerBreakdown: readonly ProviderStat[];
  readonly hourOfDay: readonly HourOfDayStat[];
  readonly dailyKindMix: readonly DailyKindMix[];
  readonly heatmap: readonly DailyActivity[];
  readonly topShows: readonly ShowStat[];
  readonly weeklyBuckets: readonly DailyActivity[];
  readonly genreBreakdown: readonly GenreStat[];
  readonly genreAffinityNote: string | null;
}

export class StatsService {
  private readonly repo: WatchStatsRepository;

  constructor(db: KunaiDatabase) {
    this.repo = new WatchStatsRepository(db);
  }

  computeStreak(mediaKind?: "movie" | "series" | "anime" | "video"): {
    current: number;
    longest: number;
  } {
    const rows = this.repo.streakDates(mediaKind);

    if (rows.length === 0) return { current: 0, longest: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    let current = 0;
    let longest = 0;
    let streak = 0;
    let prevDate: string | undefined;

    for (const date of rows) {
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
    for (const date of [...rows].reverse()) {
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

  getStats(windowDays = 30, mediaKind?: "movie" | "series" | "anime" | "video"): WatchStats {
    const { current: streakDays, longest: longestStreak } = this.computeStreak(mediaKind);
    const windowStart = windowStartIso(windowDays);

    const totals = this.repo.totalsSince(windowStart, mediaKind);
    const dayRows = this.repo.dailyActivitySince(windowStart, mediaKind);
    const heatmapRows = this.repo.dailyActivitySince(windowStart, mediaKind);
    const showRows = this.repo.topShowsSince(windowStart, mediaKind);
    const weeklyRows = this.repo.weeklyBucketsSince(windowStart, mediaKind);
    const kindRows = this.repo.kindBreakdownSince(windowStart, mediaKind);
    const dailyKindRows = this.repo.dailyKindMixSince(windowStart, mediaKind);
    const providerBreakdown = this.repo.providerBreakdownSince(windowStart, mediaKind);
    const hourOfDay = this.repo.hourOfDaySince(windowStart, mediaKind);

    const activeDays = dayRows.length;
    const completedEpisodes = totals.completedEpisodes;
    const completionRate =
      totals.rowCount > 0 ? Math.round((completedEpisodes / totals.rowCount) * 1000) / 1000 : 0;
    // Finite windows: pace over the calendar window (7d/30d).
    // All-time uses a sentinel window (~99999 days) — divide by active days
    // or the metric collapses to ~0 for any real library.
    const avgDivisor =
      windowDays >= ALL_TIME_STATS_WINDOW_DAYS ? Math.max(activeDays, 1) : Math.max(windowDays, 1);
    const avgEpisodesPerDay =
      completedEpisodes > 0 ? Math.round((completedEpisodes / avgDivisor) * 10) / 10 : 0;

    const mostActiveDay =
      dayRows.length > 0
        ? dayRows.reduce((best, row) => (row.totalSeconds > best.totalSeconds ? row : best)).date
        : null;

    let animeSeconds = 0;
    let seriesSeconds = 0;
    let movieSeconds = 0;
    let videoSeconds = 0;
    for (const row of kindRows) {
      if (row.kind === "anime") animeSeconds = row.totalSeconds;
      else if (row.kind === "series") seriesSeconds = row.totalSeconds;
      else if (row.kind === "movie") movieSeconds = row.totalSeconds;
      else if (row.kind === "video") videoSeconds = row.totalSeconds;
    }

    const dailyKindByDate = new Map<string, DailyKindMix>();
    for (const row of dailyKindRows) {
      const existing = dailyKindByDate.get(row.date) ?? {
        date: row.date,
        animeSeconds: 0,
        seriesSeconds: 0,
        movieSeconds: 0,
        videoSeconds: 0,
      };
      const next: DailyKindMix = {
        date: row.date,
        animeSeconds: existing.animeSeconds + (row.kind === "anime" ? row.totalSeconds : 0),
        seriesSeconds: existing.seriesSeconds + (row.kind === "series" ? row.totalSeconds : 0),
        movieSeconds: existing.movieSeconds + (row.kind === "movie" ? row.totalSeconds : 0),
        videoSeconds: existing.videoSeconds + (row.kind === "video" ? row.totalSeconds : 0),
      };
      dailyKindByDate.set(row.date, next);
    }

    return {
      streakDays,
      longestStreak,
      totalEpisodes: completedEpisodes,
      completedEpisodes,
      completionRate,
      seriesCompleted: totals.seriesCompleted,
      totalSeconds: totals.totalSeconds,
      avgEpisodesPerDay,
      activeDays,
      mostActiveDay,
      typeBreakdown: { animeSeconds, seriesSeconds, movieSeconds, videoSeconds },
      providerBreakdown,
      hourOfDay,
      dailyKindMix: [...dailyKindByDate.values()],
      heatmap: heatmapRows.map((row) => ({
        date: row.date,
        watchedCount: row.watchedCount,
        totalSeconds: row.totalSeconds,
      })),
      topShows: showRows.map((row) => ({
        titleId: row.titleId,
        title: row.title,
        episodeCount: row.episodeCount,
        totalSeconds: row.totalSeconds,
      })),
      weeklyBuckets: weeklyRows.map((row) => ({
        date: row.week,
        watchedCount: row.watchedCount,
        totalSeconds: row.totalSeconds,
      })),
      genreBreakdown: [],
      genreAffinityNote: null,
    };
  }

  async fetchGenreBreakdown(
    windowDays = 30,
    mediaKind?: "movie" | "series" | "anime" | "video",
  ): Promise<WatchGenreBreakdown> {
    const rows = this.repo.completedTitleWatchSecondsSince(
      windowStartIso(windowDays),
      mediaKind,
      50,
    );
    return buildWatchGenreBreakdown(rows);
  }

  applyGenreBreakdown(stats: WatchStats, breakdown: WatchGenreBreakdown): WatchStats {
    const genreAffinityNote =
      breakdown.totalTitles === 0
        ? null
        : breakdown.resolvedTitles < breakdown.totalTitles
          ? `Genres from ${breakdown.resolvedTitles} of ${breakdown.totalTitles} completed titles`
          : null;
    return {
      ...stats,
      genreBreakdown: breakdown.genres,
      genreAffinityNote,
    };
  }

  exportStatsJson(windowDays = 30, mediaKind?: "movie" | "series" | "anime" | "video"): string {
    const stats = this.getStats(windowDays, mediaKind);
    return `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        windowDays,
        mediaKind: mediaKind ?? "all",
        stats,
      },
      null,
      2,
    )}\n`;
  }

  exportStatsCsv(windowDays = 30, mediaKind?: "movie" | "series" | "anime" | "video"): string {
    const stats = this.getStats(windowDays, mediaKind);
    const lines: string[] = [
      "section,key,value",
      "summary,streakDays," + stats.streakDays,
      "summary,longestStreak," + stats.longestStreak,
      "summary,completedEpisodes," + stats.completedEpisodes,
      "summary,completionRate," + stats.completionRate,
      "summary,seriesCompleted," + stats.seriesCompleted,
      "summary,totalSeconds," + stats.totalSeconds,
      "summary,avgEpisodesPerDay," + stats.avgEpisodesPerDay,
      "summary,activeDays," + stats.activeDays,
      "summary,mostActiveDay," + csvCell(stats.mostActiveDay ?? ""),
      "",
      "topShows,titleId,title,episodeCount,totalSeconds",
      ...stats.topShows.map(
        (show) =>
          `topShows,${csvCell(show.titleId)},${csvCell(show.title)},${show.episodeCount},${show.totalSeconds}`,
      ),
      "",
      "providers,providerId,episodeCount,totalSeconds",
      ...stats.providerBreakdown.map(
        (row) => `providers,${csvCell(row.providerId)},${row.episodeCount},${row.totalSeconds}`,
      ),
      "",
      "daily,date,watchedCount,totalSeconds",
      ...stats.heatmap.map((day) => `daily,${day.date},${day.watchedCount},${day.totalSeconds}`),
    ];
    return `${lines.join("\n")}\n`;
  }

  watchedToday(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.repo.streakDates();
    return rows.includes(today);
  }
}

function windowStartIso(windowDays: number): string {
  if (windowDays >= 99_999) return "1970-01-01T00:00:00.000Z";
  return new Date(Date.now() - windowDays * 86400000).toISOString();
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
