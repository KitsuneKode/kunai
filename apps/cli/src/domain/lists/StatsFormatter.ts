import type { DailyActivity, ShowStat, WatchStats } from "./StatsService";

const BAR_FULL = "█";
const BAR_EMPTY = "░";
const HEATMAP_NONE = "·";
const HEATMAP_LOW = "░";
const HEATMAP_MED = "▒";
const HEATMAP_HIGH = "▓";
const HEATMAP_MAX = "█";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function heatmapChar(count: number, max: number): string {
  if (count === 0) return HEATMAP_NONE;
  if (max === 0) return HEATMAP_LOW;
  const ratio = count / max;
  if (ratio < 0.25) return HEATMAP_LOW;
  if (ratio < 0.5) return HEATMAP_MED;
  if (ratio < 0.75) return HEATMAP_HIGH;
  return HEATMAP_MAX;
}

export class StatsFormatter {
  formatHeatmap(heatmap: readonly DailyActivity[]): string {
    if (heatmap.length === 0) return "No data yet.";

    const byDate = new Map<string, number>();
    for (const d of heatmap) {
      byDate.set(d.date, d.watchedCount);
    }

    const maxCount = Math.max(...heatmap.map((d) => d.watchedCount), 1);

    const now = new Date();
    const endDate = new Date(now);
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setFullYear(endDate.getFullYear() - 1);

    const MONTHS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const weeks: string[][] = [];
    let week: string[] = [];
    const cur = new Date(startDate);

    while (cur.getDay() !== 0) {
      week.push("");
      cur.setDate(cur.getDate() - cur.getDay());
    }
    cur.setTime(startDate.getTime());

    let cursorTime = startDate.getTime();
    const endTime = endDate.getTime();
    while (cursorTime <= endTime) {
      const d = new Date(cursorTime);
      const dateStr = d.toISOString().slice(0, 10);
      const count = byDate.get(dateStr) ?? 0;
      week.push(heatmapChar(count, maxCount));
      if (d.getDay() === 6) {
        weeks.push(week);
        week = [];
      }
      cursorTime += 86_400_000;
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(" ");
      weeks.push(week);
    }

    const rows: string[] = [];
    const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
    for (let day = 0; day < 7; day++) {
      const label = DAY_LABELS[day as 0 | 1 | 2 | 3 | 4 | 5 | 6];
      const cells = weeks.map((w) => w[day] ?? " ").join(" ");
      rows.push(`${label} ${cells}`);
    }

    const monthRow = weeks
      .map((_, i) => {
        if (i === 0) return "";
        const d = new Date(startDate);
        d.setDate(d.getDate() + i * 7);
        const monthLabel = MONTHS[d.getMonth()];
        if (d.getDate() <= 7 && monthLabel) return monthLabel.slice(0, 1);
        return " ";
      })
      .join(" ");

    return ["   " + monthRow, ...rows].join("\n");
  }

  formatTopShows(shows: readonly ShowStat[]): string {
    if (shows.length === 0) return "No shows watched yet.";

    const maxSeconds = Math.max(...shows.map((s) => s.totalSeconds), 1);
    const BAR_WIDTH = 10;
    const titleWidth = Math.max(...shows.map((s) => s.title.length), 10);

    return shows
      .map((s) => {
        const ratio = s.totalSeconds / maxSeconds;
        const filled = Math.round(ratio * BAR_WIDTH);
        const bar = BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(BAR_WIDTH - filled);
        const title = s.title.padEnd(titleWidth).slice(0, titleWidth);
        const meta = `${s.episodeCount} ep · ${formatDuration(s.totalSeconds)}`;
        return `${title}  ${bar}  ${meta}`;
      })
      .join("\n");
  }

  formatSummaryLine(stats: WatchStats): string {
    const parts: string[] = [];
    if (stats.streakDays >= 2) {
      parts.push(`🔥 ${stats.streakDays}d streak`);
    }
    parts.push(`${stats.totalEpisodes} episodes`);
    parts.push(`${formatDuration(stats.totalSeconds)} watched`);
    return parts.join(" · ");
  }

  formatWeeklyDigest(stats: WatchStats): string {
    const buckets = stats.weeklyBuckets;
    if (buckets.length === 0) return "No watch history yet.";

    const thisWeek = buckets[buckets.length - 1];
    if (!thisWeek) return "No watch history yet.";
    const lastWeek = buckets[buckets.length - 2];

    let trend = "";
    if (lastWeek) {
      if (thisWeek.watchedCount > lastWeek.watchedCount) trend = " ↑ more than last week";
      else if (thisWeek.watchedCount < lastWeek.watchedCount) trend = " ↓ less than last week";
    }

    return `This week: ${thisWeek.watchedCount} ep · ${formatDuration(thisWeek.totalSeconds)}${trend}`;
  }
}
