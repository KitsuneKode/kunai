import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import { SegmentedControl } from "@/app-shell/primitives/SegmentedControl";
import { palette } from "@/app-shell/shell-theme";
import { buildStatsView } from "@/app-shell/stats-view";
import { StatsFormatter } from "@/domain/lists/StatsFormatter";
import type { WatchStats } from "@/domain/lists/StatsService";
import { Box, Text } from "ink";
import React from "react";

import { captureSurface } from "./render-capture";

const formatter = new StatsFormatter();

const sampleStats: WatchStats = {
  streakDays: 2,
  longestStreak: 30,
  totalEpisodes: 382,
  totalSeconds: 520_980,
  avgEpisodesPerDay: 3.1,
  activeDays: 75,
  mostActiveDay: "2026-05-16",
  typeBreakdown: { animeSeconds: 280_000, seriesSeconds: 160_000, movieSeconds: 80_980 },
  dailyKindMix: [],
  heatmap: Array.from({ length: 120 }, (_, i) => ({
    date: new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10),
    watchedCount: i % 3 === 0 ? 2 : 0,
    totalSeconds: i % 3 === 0 ? 3600 : 0,
  })),
  topShows: [
    {
      titleId: "1",
      title: "MARRIAGETOXIN",
      episodeCount: 24,
      totalSeconds: 28_800,
    },
  ],
  weeklyBuckets: [],
};

function StatsOverviewCapture({
  innerWidth = 120,
  rows = 42,
}: {
  innerWidth?: number;
  rows?: number;
}) {
  const view = buildStatsView({
    stats: sampleStats,
    statsFormatter: formatter,
    tab: "overview",
    range: "all",
    kind: "all",
    innerWidth,
    availableRows: rows - 4,
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <ClaudeTabRow labels={view.tabLabels} activeIndex={view.tabIndex} />
        <SegmentedControl
          labels={view.rangeLabels}
          activeIndex={view.rangeIndex}
          activeFg={palette.text}
          activeBg={palette.accentFill}
        />
      </Box>
      <SegmentedControl
        labels={view.kindLabels}
        activeIndex={view.kindIndex}
        activeFg={palette.text}
        activeBg={palette.accentFill}
      />
      {view.streakHero ? (
        <Text>
          <Text color={palette.accentDeep}>{"🔥 " + view.streakHero}</Text>
          {view.streakDetail ? (
            <Text color={palette.muted}>{" · " + view.streakDetail}</Text>
          ) : null}
        </Text>
      ) : null}
      <Text color={palette.dim}>{view.weeklyLine}</Text>
      {view.comparisonLine ? <Text color={palette.muted}>{view.comparisonLine}</Text> : null}
      {view.metrics.slice(0, 4).map((metric) => (
        <Text key={metric.label}>
          <Text color={palette.muted}>{metric.label}: </Text>
          <Text color={palette.text}>{metric.value}</Text>
        </Text>
      ))}
    </Box>
  );
}

await captureSurface("stats-overview", <StatsOverviewCapture />);
console.log("captured stats overview chrome");
process.exit(0);
