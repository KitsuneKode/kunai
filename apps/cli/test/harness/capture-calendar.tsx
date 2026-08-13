process.env.KUNAI_POSTER = "0";

import { CalendarDayStrip, CalendarScheduleRow } from "@/app-shell/calendar-ui";
import type { BrowseShellOption } from "@/app-shell/types";
import { useShellDimensions } from "@/app-shell/use-viewport-policy";
import { buildCalendarItem } from "@/domain/calendar/calendar-item";
import { Box } from "ink";
import React from "react";

import { captureSurface } from "./render-capture";

const dayLabels = [
  "FRI 9",
  "MON 10",
  "TUE 19",
  "MON 23",
  "MON 18",
  "MON 5",
  "MON 1",
  "MON 11",
  "SUN 26",
  "THU 13",
  "FRI 10",
  "MON 4",
  "WED 12",
  "MON 17",
  "FRI 12",
  "WED 5",
  "WED 28",
  "WED 8",
  "WED 13",
];
const dayStripDays = dayLabels.map((label, i) => ({
  key: `d${i}`,
  label,
  isToday: i === 6,
}));

const now = Date.parse("2026-05-27T12:00:00.000Z");

function calOpt(input: {
  label: string;
  kind?: "anime" | "series" | "movie";
  releaseAt: string | null;
  status: "released" | "upcoming" | "unknown";
  episode?: number;
  inWatchlist?: boolean;
}): BrowseShellOption<{ metadataSource?: string }> {
  const item = buildCalendarItem(
    {
      source: input.kind === "anime" ? "anilist" : "tmdb",
      titleId: input.label,
      titleName: input.label,
      type: input.kind ?? "series",
      episode: input.episode,
      releaseAt: input.releaseAt,
      releasePrecision: input.releaseAt ? "date" : "unknown",
      status: input.status,
    },
    { nowMs: now, inWatchlist: input.inWatchlist },
  );
  return {
    value: { metadataSource: "TMDB calendar" },
    label: input.label,
    detail: "",
    calendar: item,
    previewBadge: item.display.badge,
  } as BrowseShellOption<{ metadataSource?: string }>;
}

const rows = [
  calOpt({ label: "Coronation Street", releaseAt: "2026-05-25", status: "released" }),
  calOpt({
    label: "Frieren: Beyond Journey's End",
    kind: "anime",
    releaseAt: "2026-05-27T18:00:00.000Z",
    status: "upcoming",
    episode: 29,
    inWatchlist: true,
  }),
  calOpt({ label: "One Piece", kind: "anime", releaseAt: "2026-05-29", status: "upcoming" }),
];

/**
 * Reads the ACTUAL terminal width for each capture. The previous fixed
 * `width={96}` rendered the same 96-column layout into files named narrow (72)
 * and medium (100), so the narrow capture could not fail on overflow and the
 * wide one never showed the wide layout.
 */
function CalendarList() {
  const { cols } = useShellDimensions();
  const width = cols;
  return (
    <Box flexDirection="column" width={width}>
      {rows.map((o, i) => (
        <CalendarScheduleRow
          key={`${o.label}:${o.calendar?.reason ?? "unknown"}`}
          option={o}
          selected={i === 0}
          rowWidth={width}
          showTimeHeader={false}
          showTbdHeader={false}
          showSectionHeader={i === 0 ? "Also today" : null}
          timeLabel=""
          nowMs={now}
        />
      ))}
    </Box>
  );
}

function CalendarStrip() {
  const { cols } = useShellDimensions();
  return <CalendarDayStrip days={dayStripDays} selectedDayKey="d6" maxWidth={cols} />;
}

await captureSurface("calendar-rows", <CalendarList />);
await captureSurface("calendar-daystrip", <CalendarStrip />);
console.log("captured calendar rows + day strip");
process.exit(0);
