// =============================================================================
// stats-view.ts — pure view-model builder for Stats UI
//
// Design authority: .design/cli/kunai-sakura-canonical.html (Stats section)
// =============================================================================

import type { StatsFormatter } from "@/domain/lists/StatsFormatter";
import type {
  DailyKindMix,
  ShowStat,
  TypeBreakdown,
  WatchStats,
} from "@/domain/lists/StatsService";

import { heatBucket } from "./format/heatmap";
import { palette, resolveStatsTintColor, statsHeatCellColor } from "./shell-theme";

export const STATS_TABS = ["overview", "titles"] as const;
export type StatsTab = (typeof STATS_TABS)[number];

export const STATS_RANGES = ["all", "7d", "30d"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const STATS_KINDS = ["all", "anime", "series", "movie"] as const;
export type StatsKind = (typeof STATS_KINDS)[number];

export const STATS_TAB_LABELS = ["Overview", "Titles"] as const;
export const STATS_RANGE_LABELS = ["All time", "Last 7d", "Last 30d"] as const;
export const STATS_KIND_LABELS = ["All", "Anime", "Series", "Movies"] as const;

export const STATS_RANGE_DAYS: Record<StatsRange, number> = {
  all: 99_999,
  "7d": 7,
  "30d": 30,
};

const HEATMAP_CHARS = ["·", "░", "▒", "▓", "█"] as const;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;
const BAR_WIDTH = 8;

const FUN_BENCHMARKS = [
  { label: "The Lord of the Rings: Extended Edition trilogy", minutes: 682 },
  { label: "a full anime cour (12 × 24m)", minutes: 288 },
  { label: "every Harry Potter film", minutes: 1_179 },
  { label: "the entire Breaking Bad run", minutes: 2_780 },
] as const;

export type StatsMetric = {
  readonly label: string;
  readonly value: string;
  readonly suffix?: string;
};

export type StatsHeatmapCell = {
  readonly char: string;
  readonly color: string;
  readonly count: number;
  readonly date: string;
};

export type StatsHeatmapWeek = {
  readonly cells: readonly StatsHeatmapCell[];
  readonly weekStartDate: string;
};

export type StatsTitleRow = {
  readonly titleId: string;
  readonly title: string;
  readonly episodeCount: number;
  readonly durationLabel: string;
  readonly barFilled: string;
  readonly barEmpty: string;
  readonly meta: string;
};

export type StatsView = {
  readonly tab: StatsTab;
  readonly tabLabels: readonly string[];
  readonly tabIndex: number;
  readonly range: StatsRange;
  readonly rangeLabels: readonly string[];
  readonly rangeIndex: number;
  readonly kind: StatsKind;
  readonly kindLabels: readonly string[];
  readonly kindIndex: number;
  readonly state: "empty" | "success";
  readonly streakHero: string | null;
  readonly streakDetail: string | null;
  readonly weeklyLine: string;
  readonly comparisonLine: string | null;
  readonly metrics: readonly StatsMetric[];
  readonly typeBreakdownBar: readonly { color: string; widthPct: number }[];
  readonly typeBreakdownLabel: string | null;
  readonly heatmap: {
    readonly grid: readonly StatsHeatmapWeek[];
    readonly monthLabels: readonly { weekStartDate: string; label: string }[];
    readonly legend: readonly { color: string; char: string }[];
    readonly dayLabels: readonly string[];
  } | null;
  readonly topTitles: readonly StatsTitleRow[];
  readonly footerHints: string;
};

export function statsTabFromIndex(index: number): StatsTab {
  return STATS_TABS[Math.max(0, Math.min(STATS_TABS.length - 1, index))] ?? "overview";
}

export function statsRangeFromIndex(index: number): StatsRange {
  return STATS_RANGES[Math.max(0, Math.min(STATS_RANGES.length - 1, index))] ?? "all";
}

export function statsKindFromIndex(index: number): StatsKind {
  return STATS_KINDS[Math.max(0, Math.min(STATS_KINDS.length - 1, index))] ?? "all";
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function heatmapChar(bucket: number): string {
  return HEATMAP_CHARS[Math.max(0, Math.min(HEATMAP_CHARS.length - 1, bucket))] ?? "·";
}

function kindMixForDate(
  dailyKindMix: readonly DailyKindMix[],
  date: string,
): { anime: number; series: number; movie: number } | null {
  const row = dailyKindMix.find((entry) => entry.date === date);
  if (!row) return null;
  return {
    anime: row.animeSeconds,
    series: row.seriesSeconds,
    movie: row.movieSeconds,
  };
}

function buildHeatmapGrid(input: {
  readonly heatmap: WatchStats["heatmap"];
  readonly dailyKindMix: readonly DailyKindMix[];
  readonly kindFilter: StatsKind;
  readonly maxWeeks: number;
}): {
  grid: StatsHeatmapWeek[];
  monthLabels: { weekStartDate: string; label: string }[];
} {
  const byDate = new Map<string, number>();
  for (const day of input.heatmap) byDate.set(day.date, day.watchedCount);
  const maxCount = Math.max(...input.heatmap.map((day) => day.watchedCount), 1);

  const now = new Date();
  const endDate = new Date(now);
  endDate.setHours(0, 0, 0, 0);
  const startMs = endDate.getTime() - input.maxWeeks * 7 * 86_400_000;
  const startDate = new Date(startMs);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const grid: StatsHeatmapWeek[] = [];
  const monthLabels: { weekStartDate: string; label: string }[] = [];
  let lastMonth = -1;
  let cur = new Date(startDate);

  while (cur.getTime() <= endDate.getTime() && grid.length < input.maxWeeks) {
    const weekStartDate = cur.toISOString().slice(0, 10);
    const cells: StatsHeatmapCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const dateStr = cur.toISOString().slice(0, 10);
      const count = byDate.get(dateStr) ?? 0;
      const bucket = heatBucket(count, maxCount);
      const tint = resolveStatsTintColor({
        kindFilter: input.kindFilter,
        mix: kindMixForDate(input.dailyKindMix, dateStr),
      });
      cells.push({
        char: heatmapChar(bucket),
        color: statsHeatCellColor(bucket, tint),
        count,
        date: dateStr,
      });
      if (day === 0 && cur.getMonth() !== lastMonth) {
        monthLabels.push({ weekStartDate, label: MONTHS[cur.getMonth()] ?? "" });
        lastMonth = cur.getMonth();
      }
      cur.setDate(cur.getDate() + 1);
    }
    grid.push({ cells, weekStartDate });
  }

  return { grid, monthLabels };
}

function buildTypeBreakdown(breakdown: TypeBreakdown): {
  bar: { color: string; widthPct: number }[];
  label: string | null;
} {
  const total = breakdown.animeSeconds + breakdown.seriesSeconds + breakdown.movieSeconds;
  if (total <= 0) return { bar: [], label: null };

  const animePct = Math.round((breakdown.animeSeconds / total) * 100);
  const seriesPct = Math.round((breakdown.seriesSeconds / total) * 100);
  const moviePct = Math.max(0, 100 - animePct - seriesPct);

  return {
    bar: [
      { color: palette.typeAnime, widthPct: animePct },
      { color: palette.typeSeries, widthPct: seriesPct },
      { color: palette.typeMovie, widthPct: moviePct },
    ].filter((segment) => segment.widthPct > 0),
    label: `${animePct}% anime · ${seriesPct}% series · ${moviePct}% movies`,
  };
}

function buildComparisonLine(totalSeconds: number): string | null {
  if (totalSeconds < 3_600) return null;
  const totalMinutes = totalSeconds / 60;
  let best: { multiplier: number; label: string } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const benchmark of FUN_BENCHMARKS) {
    const raw = totalMinutes / benchmark.minutes;
    if (raw < 0.75) continue;
    const multiplier = Math.max(1, Math.round(raw));
    const distance = Math.abs(raw - multiplier);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { multiplier, label: benchmark.label };
    }
  }

  if (!best) return null;
  const timesWord = best.multiplier === 1 ? "as much as" : `${best.multiplier}×`;
  return `You've watched ${timesWord} ${best.label}.`;
}

function buildMetrics(input: {
  readonly stats: WatchStats;
  readonly rangeDays: number;
}): StatsMetric[] {
  const topTitle = input.stats.topShows[0]?.title ?? "—";
  const activeSuffix = input.rangeDays >= 99_999 ? "" : `/${input.rangeDays}`;
  return [
    { label: "Episodes watched", value: String(input.stats.totalEpisodes) },
    { label: "Total watch time", value: formatDuration(input.stats.totalSeconds) },
    {
      label: "Active days",
      value: String(input.stats.activeDays),
      suffix: activeSuffix || undefined,
    },
    { label: "Most-watched title", value: topTitle },
    {
      label: "Most active day",
      value: input.stats.mostActiveDay ? formatShortDate(input.stats.mostActiveDay) : "—",
    },
    { label: "Longest streak", value: `${input.stats.longestStreak} days` },
  ];
}

function buildTitleRows(
  shows: readonly ShowStat[],
  maxRows: number,
  titleWidth: number,
): StatsTitleRow[] {
  const slice = shows.slice(0, maxRows);
  const maxSeconds = Math.max(...slice.map((show) => show.totalSeconds), 1);
  return slice.map((show) => {
    const ratio = show.totalSeconds / maxSeconds;
    const filled = show.totalSeconds > 0 ? Math.max(1, Math.round(ratio * BAR_WIDTH)) : 0;
    const h = Math.floor(show.totalSeconds / 3600);
    const m = Math.floor((show.totalSeconds % 3600) / 60);
    const duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const titleDisplay = show.title.slice(0, titleWidth).padEnd(titleWidth);
    return {
      titleId: show.titleId,
      title: titleDisplay,
      episodeCount: show.episodeCount,
      durationLabel: duration,
      barFilled: "█".repeat(filled),
      barEmpty: "░".repeat(BAR_WIDTH - filled),
      meta: `${show.episodeCount}ep · ${duration}`,
    };
  });
}

export function buildStatsView(input: {
  readonly stats: WatchStats;
  readonly statsFormatter: StatsFormatter;
  readonly tab: StatsTab;
  readonly range: StatsRange;
  readonly kind: StatsKind;
  readonly innerWidth: number;
  readonly availableRows: number;
  readonly nowMs?: number;
}): StatsView {
  const rangeDays = STATS_RANGE_DAYS[input.range];
  const isEmpty = input.stats.totalEpisodes === 0 && input.stats.totalSeconds === 0;
  const summaryLine = input.statsFormatter.formatSummaryLine(input.stats);
  const weeklyLine = input.statsFormatter.formatWeeklyDigest(input.stats);

  const showHeatmap = input.availableRows >= 18 && input.tab === "overview";
  const maxWeeks = Math.min(52, Math.max(8, Math.floor((input.innerWidth - 4) / 2)));
  const heatmapData =
    showHeatmap && input.stats.heatmap.length > 0
      ? buildHeatmapGrid({
          heatmap: input.stats.heatmap,
          dailyKindMix: input.stats.dailyKindMix,
          kindFilter: input.kind,
          maxWeeks,
        })
      : null;

  const fixedRows =
    2 + 2 + (showHeatmap && heatmapData ? 9 : 0) + (input.tab === "overview" ? 8 : 3) + 3;
  const showsRowBudget = Math.max(0, input.availableRows - fixedRows - 2);
  const maxTopTitles = Math.min(input.tab === "titles" ? 12 : 5, showsRowBudget);

  const rawTitleWidth =
    maxTopTitles > 0
      ? Math.max(...input.stats.topShows.slice(0, maxTopTitles).map((show) => show.title.length), 6)
      : 0;
  const titleWidth = Math.min(rawTitleWidth, Math.max(10, input.innerWidth - BAR_WIDTH - 24));

  const { bar, label } = buildTypeBreakdown(input.stats.typeBreakdown);
  const streakHero = input.stats.streakDays >= 2 ? `${input.stats.streakDays}-day streak` : null;
  const streakDetail =
    input.stats.streakDays >= 2 ? `longest ${input.stats.longestStreak} days` : summaryLine;

  return {
    tab: input.tab,
    tabLabels: STATS_TAB_LABELS,
    tabIndex: STATS_TABS.indexOf(input.tab),
    range: input.range,
    rangeLabels: STATS_RANGE_LABELS,
    rangeIndex: STATS_RANGES.indexOf(input.range),
    kind: input.kind,
    kindLabels: STATS_KIND_LABELS,
    kindIndex: STATS_KINDS.indexOf(input.kind),
    state: isEmpty ? "empty" : "success",
    streakHero,
    streakDetail,
    weeklyLine,
    comparisonLine: buildComparisonLine(input.stats.totalSeconds),
    metrics: buildMetrics({ stats: input.stats, rangeDays }),
    typeBreakdownBar: bar,
    typeBreakdownLabel: label,
    heatmap: heatmapData
      ? {
          grid: heatmapData.grid,
          monthLabels: heatmapData.monthLabels,
          legend: [0, 1, 2, 3, 4].map((index) => ({
            color: statsHeatCellColor(index, palette.typeAnime),
            char: heatmapChar(index),
          })),
          dayLabels: DAY_LABELS,
        }
      : null,
    topTitles: buildTitleRows(input.stats.topShows, maxTopTitles, titleWidth),
    footerHints: "←→ tab · Tab range · ⇧Tab type · s share · q back",
  };
}
