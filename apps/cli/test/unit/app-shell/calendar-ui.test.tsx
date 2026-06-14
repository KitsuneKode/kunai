import { describe, expect, it } from "bun:test";

import { CalendarScheduleRow } from "@/app-shell/calendar-ui";
import type { BrowseShellOption } from "@/app-shell/types";
import type { CalendarItem } from "@/domain/calendar/calendar-item";
import type { SearchResult } from "@/domain/types";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

function option(title: string): BrowseShellOption<SearchResult> {
  const calendar: CalendarItem = {
    source: "anilist",
    titleId: "t1",
    title,
    contentKind: "anime",
    releaseAt: "2026-06-14T06:00:00.000Z",
    releasePrecision: "timestamp",
    releaseStatus: "released",
    providerConfirmed: false,
    reason: "catalog-only",
    dayKey: "2026-06-14",
    poster: null,
    display: {
      time: "6:00 AM",
      statusLabel: "available",
      episodeCode: "E07",
      groupLabel: "SUN 14",
    },
  };
  return {
    label: title,
    value: { id: "t1", type: "series", title, calendar } as unknown as SearchResult,
    calendar,
  } as BrowseShellOption<SearchResult>;
}

describe("CalendarScheduleRow new marker", () => {
  it("shows a ● dot for a new release", () => {
    const frame = captureFrame(
      <CalendarScheduleRow
        option={option("Frieren")}
        selected={false}
        rowWidth={80}
        timeLabel="6:00 AM"
        isNew
      />,
      { columns: 100 },
    );
    expect(frame).toContain("●");
    expect(frame).toContain("Frieren");
  });

  it("omits the dot for an already-seen release", () => {
    const frame = captureFrame(
      <CalendarScheduleRow
        option={option("Old Show")}
        selected={false}
        rowWidth={80}
        timeLabel="6:00 AM"
        isNew={false}
      />,
      { columns: 100 },
    );
    expect(frame).not.toContain("●");
    expect(frame).toContain("Old Show");
  });

  it("renders the title + new dot at wide and narrow widths without throwing", () => {
    for (const columns of [130, 60]) {
      const frame = captureFrame(
        <CalendarScheduleRow
          option={option("Frieren")}
          selected={false}
          rowWidth={columns - 8}
          timeLabel="6:00 AM"
          isNew
          posterUrl="https://img.example/frieren.jpg"
        />,
        { columns },
      );
      expect(frame).toContain("●");
      expect(frame).toContain("Frieren");
    }
  });
});
