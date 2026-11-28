import { describe, expect, it } from "bun:test";

import { PostPlayShell } from "@/app-shell/post-play-shell";
import { measureColumns } from "@/app-shell/shell-text";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const recs = [
  { id: "r1", title: "Frieren", type: "series" as const, posterPath: "/a.jpg", year: "2023" },
  { id: "r2", title: "Dandadan", type: "series" as const, posterPath: "/b.jpg", year: "2024" },
];

function widestLineColumns(frame: string): number {
  return Math.max(...frame.split("\n").map((line) => measureColumns(line.trimEnd())));
}

function occurrences(frame: string, needle: string): number {
  return frame.split(needle).length - 1;
}

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

  it("advertises the manual play accelerator, never a live countdown", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        nextEpisodeLabel="S01 E02 — Next One"
        postPlayState={{ kind: "mid-series" }}
      />,
      { columns: 130 },
    );
    // The countdown ticks on the mpv overlay and is cleared before this menu
    // mounts; the hero must not imply a self-advancing timer.
    expect(frame).not.toContain("Playing in");
    expect(frame).toContain("↵ play");
  });

  it("keeps stopped-early resume in one action row instead of duplicating the hero", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="Fight Club"
        episodeLabel=""
        postPlayState={{ kind: "mid-series" }}
        resumeLabel="resume 1:59"
      />,
      { columns: 130 },
    );
    expect(frame).toContain("↵ Resume");
    expect(occurrences(frame, "Resume")).toBe(1);
    expect(frame).not.toContain("▶ RESUME");
    expect(frame).not.toContain("▶ UP NEXT");
  });

  it("renders elapsed and total runtime in the stopped-early menu", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E03"
        postPlayState={{ kind: "mid-series" }}
        resumeLabel="resume S01E03 · 0:23"
        resumePositionSeconds={23}
        episodeDurationSeconds={2891}
        totalEpisodes={10}
        watchedEpisodes={3}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("0:23 / 48:11");
    expect(frame).not.toContain("0:23 / 48:11 · 1%");
    expect(frame).not.toContain("3 / 10 · 30%");
  });

  it("does not offer an episode-list accelerator on a movie queue hero", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="Fight Club"
        episodeLabel=""
        postPlayState={{ kind: "series-complete" }}
        queueNextLabel="Another Movie"
        queueNextEntryId="queue-1"
      />,
      { columns: 130 },
    );
    expect(frame).toContain("▶ FROM QUEUE");
    expect(frame).not.toContain("e episodes");
  });

  it("offers the episode list on a series next-up hero", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E01"
        nextEpisodeLabel="S01 E02 — Next One"
        postPlayState={{ kind: "mid-series" }}
      />,
      { columns: 130 },
    );
    expect(frame).toContain("e episodes");
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

describe("PostPlayShell key hints", () => {
  it("leaves key discovery to ShellFooter instead of printing a phantom cancel legend", () => {
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
    expect(frame).not.toContain("x cancel");
    expect(frame).not.toContain("↑↓ move");
    expect(frame).not.toContain("1·2·3 picks");
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
  it("keeps every line inside 54 columns and compacts the hero below the box threshold", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 54, rows: 25 });
    expect(frame).toContain("▶ UP NEXT");
    expect(frame).not.toContain("╭");
    expect(widestLineColumns(frame)).toBeLessThanOrEqual(54);
  });
  it("keeps stopped-early inside 40 columns without a duplicate resume card", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="Smoke Movie"
        episodeLabel=""
        postPlayState={{ kind: "series-complete" }}
        resumeLabel="resume 0:12"
        resumePositionSeconds={12}
        episodeDurationSeconds={600}
      />,
      { columns: 40, rows: 20 },
    );
    expect(frame).toContain("↵ Resume");
    expect(frame).not.toContain("▶ RESUME");
    expect(frame).not.toContain("x cancel");
    expect(frame).not.toContain("╭");
    expect(widestLineColumns(frame)).toBeLessThanOrEqual(40);
  });
  it("blocks below the usable minimum with a resize hint", () => {
    const frame = captureFrame(<PostPlayShell {...base} />, { columns: 36 });
    // Below 40 columns the message wraps; the minimum line says what to do.
    expect(frame).toContain("Resize terminal to see post-play");
    expect(frame).toContain("needs 40×16");
    expect(frame).not.toContain("My Show");
  });
});
