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
});
