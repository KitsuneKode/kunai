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
});
