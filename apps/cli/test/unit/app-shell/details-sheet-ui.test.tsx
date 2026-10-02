import { describe, expect, it } from "bun:test";

import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const seed = { title: "Frieren", type: "series" as const, year: "2023", score: 8.9 };

describe("DetailsSheet", () => {
  it("shows skeletons before the detail loads", () => {
    const model = buildDetailsSheet({ seed, detail: null, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    expect(frame).toContain("Frieren");
    expect(frame).toContain("★8.9");
    expect(frame).toContain("░");
  });

  it("renders synopsis, facts, links and actions once loaded", () => {
    const detail = {
      id: "1",
      type: "series",
      title: "Frieren",
      synopsis: "An elf mage journeys.",
      genres: ["Adventure"],
      studios: ["Madhouse"],
      episodeCount: 28,
      cast: [{ name: "Atsumi", kind: "voice" }],
      externalLinks: [{ label: "MyAnimeList", url: "https://mal/1" }],
      trailerUrl: "https://yt/abc",
    } as unknown as TitleDetail;
    const model = buildDetailsSheet({ seed, detail, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    expect(frame).toContain("An elf mage journeys.");
    expect(frame).toContain("Madhouse");
    expect(frame).toContain("MyAnimeList");
    expect(frame).toContain("trailer");
  });

  it("legend prints only keys the overlay handler actually answers", () => {
    const model = buildDetailsSheet({ seed, detail: null, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    // Real keymap: ↵ submit · q queue · w watchlist · s seasons (when rows
    // exist) · t trailer / l links (when present) · esc.
    expect(frame).toContain("q queue · w watchlist");
    expect(frame).toContain("· esc");
    expect(frame).not.toContain("+ queue");
    expect(frame).not.toContain("follow");
    expect(frame).not.toContain("e episodes");
    // `↵` and `d` are gated on `searchReady` at press time — hidden by default.
    expect(frame).not.toContain("↵ play");
    expect(frame).not.toContain("d download");
    // No seasons in this model — `s` must not be advertised either.
    expect(frame).not.toContain("s seasons");
  });

  it("advertises download and seasons only when they exist", () => {
    const detail: TitleDetail = {
      id: "1",
      type: "series",
      title: "Frieren",
      episodeCount: 28,
      seasonCount: 2,
      seasons: [
        { season: 1, name: "Season 1" },
        { season: 2, name: "Season 2" },
      ],
    };
    const model = buildDetailsSheet({ seed, detail, history: null, availability: null });
    const frame = captureFrame(
      <DetailsSheet model={model} seasonsExpanded={false} width={90} searchReady />,
      { columns: 100 },
    );
    expect(frame).toContain("d download");
    expect(frame).toContain("s seasons");
  });
});
