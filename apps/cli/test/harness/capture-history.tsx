import { HistoryShell } from "@/app-shell/history-shell";
import { buildHistoryView } from "@/app-shell/history-view";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import React from "react";

import { captureSurface } from "./render-capture";

function entry(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Frieren: Beyond Journey's End",
    type: "series",
    season: 1,
    episode: 28,
    timestamp: 720,
    duration: 1440,
    completed: false,
    provider: "allanime",
    watchedAt: "2026-05-27T10:00:00.000Z",
    ...patch,
  };
}

const entries: [string, HistoryEntry][] = [
  ["tmdb:1", entry()],
  [
    "tmdb:2",
    entry({
      title: "Blue Lock",
      episode: 14,
      timestamp: 0,
      duration: 1440,
      watchedAt: "2026-05-20T10:00:00.000Z",
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
