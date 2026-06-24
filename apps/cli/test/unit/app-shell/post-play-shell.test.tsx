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

  it("advertises the manual resume/play accelerator, never a live countdown", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        nextEpisodeLabel="S01 E02 — Next One"
        postPlayState={{ kind: "mid-series" }}
        resumeLabel="Resume S01 E02"
      />,
      { columns: 130 },
    );
    // The countdown ticks on the mpv overlay and is cleared before this menu
    // mounts; the hero must not imply a self-advancing timer.
    expect(frame).not.toContain("Playing in");
    expect(frame).toContain("↵ resume");
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

describe("PostPlayShell keys footer", () => {
  it("renders a legible keys footer", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        nextEpisodeLabel="S01 E02 — Next One"
        postPlayState={{ kind: "mid-series" }}
        recommendations={recs}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("↑↓ move");
    expect(frame).toContain("1·2·3 picks");
  });
});

describe("PostPlayShell responsive", () => {
  const base = {
    title: "My Show",
    episodeLabel: "S01 E01",
    nextEpisodeLabel: "S01 E02 — Next One",
    postPlayState: { kind: "mid-series" as const },
    recommendations: recs,
  };
  it("wide renders hero + poster tiles + footer without throwing", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 140 });
    expect(frame).toContain("▶ UP NEXT");
    expect(frame).toContain("Frieren");
  });
  it("medium renders the hero", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 90 });
    expect(frame).toContain("▶ UP NEXT");
  });
  it("narrow degrades to compact picks, no posters wall", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 72 });
    expect(frame).toContain("My Show");
  });
  it("blocks below the usable minimum with a resize hint", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 50 });
    expect(frame).toContain("Resize terminal to see post-play options");
    expect(frame).not.toContain("My Show");
  });
});
