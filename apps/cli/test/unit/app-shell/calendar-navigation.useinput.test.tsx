import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import React from "react";

import { render } from "../../harness/render-capture";

function calendarOption(
  label: string,
  dayKey: string,
  hour: number,
): BrowseShellOption<SearchResult> {
  const releaseAt = `${dayKey}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  return {
    label,
    value: {
      id: label,
      type: "series",
      title: label,
      year: "2026",
      overview: "",
      posterPath: null,
      calendar: {
        source: "anilist",
        titleId: label,
        title: label,
        contentKind: "anime",
        releaseAt,
        releasePrecision: "timestamp",
        releaseStatus: "upcoming",
        providerConfirmed: false,
        reason: "upcoming-episode",
        dayKey,
        display: {
          time: `${hour}:00`,
          statusLabel: "airs later",
          episodeCode: "E01",
          groupLabel: dayKey,
        },
      },
    },
    calendar: {
      source: "anilist",
      titleId: label,
      title: label,
      contentKind: "anime",
      releaseAt,
      releasePrecision: "timestamp",
      releaseStatus: "upcoming",
      providerConfirmed: false,
      reason: "upcoming-episode",
      dayKey,
      display: {
        time: `${hour}:00`,
        statusLabel: "airs later",
        episodeCode: "E01",
        groupLabel: dayKey,
      },
    },
  };
}

test("calendar processes a mixed horizontal and vertical key burst without losing a move", () => {
  const selected: SearchResult[] = [];
  const options = [
    calendarOption("Day one first", "2026-06-01", 10),
    calendarOption("Day one second", "2026-06-01", 12),
    calendarOption("Day two first", "2026-06-02", 10),
    calendarOption("Day two second", "2026-06-02", 12),
  ];
  const handle = render(
    <BrowseShell
      mode="anime"
      provider="allanime"
      initialResults={options}
      initialResultSubtitle="4 this week · schedule"
      placeholder="Search"
      commands={[]}
      onSearch={async () => ({ options: [], subtitle: "", emptyMessage: "" })}
      onResolve={() => {}}
      onSubmit={(value) => selected.push(value)}
      onCancel={() => {}}
    />,
    { columns: 120, rows: 30 },
  );

  try {
    // Date two → second row, then back to date one → second row. Every arrow
    // must be applied even when the terminal delivers them in one read cycle.
    handle.stdin.enqueue(["\u001b[C", "\u001b[B", "\u001b[D", "\u001b[B", "\r"]);
    expect(selected.map((item) => item.title)).toEqual(["Day one second"]);
  } finally {
    handle.unmount();
  }
});
