import { describe, expect, it } from "bun:test";

import { PostPlayShell } from "@/app-shell/post-play-shell";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const recs = [
  { id: "r1", title: "Frieren", type: "series" as const, posterPath: "/a.jpg", year: "2023" },
  { id: "r2", title: "Dandadan", type: "series" as const, posterPath: "/b.jpg", year: "2024" },
];

describe("PostPlayShell discovery posters", () => {
  it("renders pick titles in the wide layout", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        postPlayState={{ kind: "mid-series" }}
        recommendations={recs}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("Frieren");
    expect(frame).toContain("Dandadan");
  });
});

describe("PostPlayShell Next-Up hero", () => {
  it("renders the Next-Up hero card label", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        nextEpisodeLabel="S01 E02 — Challengers of Science"
        postPlayState={{ kind: "mid-series" }}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("▶ UP NEXT");
    expect(frame).toContain("Challengers of Science");
  });

  it("shows the live countdown in the hero when seconds are set", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        nextEpisodeLabel="S01 E02 — Next One"
        postPlayState={{ kind: "mid-series" }}
        autoNextCountdownSeconds={4}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("Playing in 4s");
  });
});

describe("PostPlayShell series-complete celebration", () => {
  it("renders the milestone banner with stats and watch-time", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S02 E12"
        postPlayState={{ kind: "series-complete" }}
        totalEpisodes={28}
        currentSeason={2}
        watchTimeSummary="You watched ~11h over 9 days"
      />,
      { columns: 130 },
    );
    expect(frame).toContain("SERIES COMPLETE");
    expect(frame).toContain("28 episodes");
    expect(frame).toContain("You watched ~11h over 9 days");
  });
});
