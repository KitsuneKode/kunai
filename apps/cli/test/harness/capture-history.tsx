import { HistoryShell } from "@/app-shell/history-shell";
import { buildHistoryView } from "@/app-shell/history-view";
import type { HistoryProgress } from "@kunai/storage";
import React from "react";

import { captureSurface } from "./render-capture";

function entry(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "x",
    title: "Frieren: Beyond Journey's End",
    mediaKind: "series",
    season: 1,
    episode: 28,
    positionSeconds: 720,
    durationSeconds: 1440,
    completed: false,
    providerId: "allanime",
    updatedAt: "2026-05-27T10:00:00.000Z",
    createdAt: "2026-05-27T10:00:00.000Z",
    ...patch,
  };
}

const entries: [string, HistoryProgress][] = [
  ["tmdb:1", entry()],
  [
    "tmdb:2",
    entry({
      title: "Blue Lock",
      episode: 14,
      positionSeconds: 0,
      durationSeconds: 1440,
      updatedAt: "2026-05-20T10:00:00.000Z",
    }),
  ],
];

const view = buildHistoryView({
  entries,
  tab: "continue",
  filterQuery: "",
  selectedIndex: 0,
  maxVisible: 12,
  narrow: false,
  context: {},
});

await captureSurface(
  "history-continue",
  <HistoryShell view={view} columns={140} listWidth={96} rowWidth={92} />,
);
console.log("captured history continue tab");
process.exit(0);
