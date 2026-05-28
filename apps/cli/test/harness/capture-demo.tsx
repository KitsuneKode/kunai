// Example capture runner — `bun apps/cli/test/harness/capture-demo.tsx`.
// Agents copy this: import their surface, build realistic prop fixtures per
// state, and call captureSurface() to write before/after frames.
//
// Sweeps post-play across every state so layout/visibility regressions show up
// in test/__captures__/ at narrow + wide.

import { PostPlayShell } from "@/app-shell/post-play-shell";
import type { PostPlayShellProps } from "@/app-shell/post-play-shell";
import type { PlaybackRecommendationRailItem } from "@/app-shell/types";
import type { PostPlayState } from "@/domain/playback/post-play-state";
import React from "react";

import { captureSurface } from "./render-capture";

const recs: readonly PlaybackRecommendationRailItem[] = [
  { id: "1", title: "Frieren", type: "series", year: "2023", overview: "Slow-burn fantasy." },
  { id: "2", title: "Vinland Saga", type: "series", year: "2019" },
  { id: "3", title: "Heavenly Delusion", type: "series", year: "2023" },
];

const base: PostPlayShellProps = {
  title: "DR. STONE",
  episodeLabel: "S04E07",
  nextEpisodeLabel: "S04 E32 — Challengers of Science",
  postPlayState: { kind: "mid-series" },
  recommendations: recs,
  totalEpisodes: 12,
  watchedEpisodes: 7,
  currentSeason: 4,
};

const states: ReadonlyArray<readonly [string, Partial<PostPlayShellProps>]> = [
  ["mid-series", {}],
  ["stopped-early", { resumeLabel: "resume S04E07  ·  18:49" }],
  [
    "caught-up",
    { postPlayState: { kind: "caught-up", nextAirDate: "Thu 23:00" } as PostPlayState },
  ],
  [
    "season-finale",
    { postPlayState: { kind: "season-finale", hasNextSeason: true } as PostPlayState },
  ],
  ["series-complete", { postPlayState: { kind: "series-complete" } as PostPlayState }],
  ["movie", { episodeLabel: "Movie", postPlayState: { kind: "mid-series" } }],
  ["did-not-start", { postPlayState: { kind: "did-not-start" } as PostPlayState }],
];

for (const [name, override] of states) {
  await captureSurface(`post-play.${name}`, <PostPlayShell {...base} {...override} />);
}
console.log(`captured ${states.length} post-play states`);
process.exit(0);
