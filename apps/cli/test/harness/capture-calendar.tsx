import { CalendarDayStrip, CalendarScheduleRow } from "@/app-shell/calendar-ui";
import type { BrowseShellOption } from "@/app-shell/types";
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

function opt(over: Partial<BrowseShellOption<{ metadataSource?: string }>>): BrowseShellOption<{
  metadataSource?: string;
}> {
  return {
    value: { metadataSource: "TMDB calendar" },
    label: "Coronation Street",
    detail: "S01E5 · available Fri, Dec 9",
    previewGroup: "Also today",
    previewTime: "",
    releaseStatus: "released",
    ...over,
  } as BrowseShellOption<{ metadataSource?: string }>;
}

const rows = [
  opt({ label: "Coronation Street", releaseStatus: "released", previewGroup: "Earlier" }),
  opt({
    label: "Frieren: Beyond Journey's End",
    releaseStatus: "airing-today",
    previewBadge: "wl",
  }),
  opt({ label: "One Piece", releaseStatus: "upcoming" }),
];

function CalendarList({ width }: { width: number }) {
  return (
    <Box flexDirection="column" width={width}>
      {rows.map((o, i) => (
        <CalendarScheduleRow
          key={`${o.label}:${o.previewGroup ?? "day"}:${o.releaseStatus ?? "unknown"}`}
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

await captureSurface("calendar-rows", <CalendarList width={96} />);
await captureSurface(
  "calendar-daystrip",
  <CalendarDayStrip days={dayStripDays} selectedDayKey="d6" />,
);
console.log("captured calendar rows + day strip");
process.exit(0);
