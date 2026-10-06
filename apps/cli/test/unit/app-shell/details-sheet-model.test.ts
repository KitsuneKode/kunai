import { describe, expect, it } from "bun:test";

import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import type { TitleDetail } from "@/domain/catalog/title-detail";

const seed = {
  title: "Frieren",
  type: "series" as const,
  year: "2023",
  score: 8.9,
  posterUrl: "p.jpg",
};

describe("buildDetailsSheet", () => {
  it("renders the header from the seed with no detail (gap sections load)", () => {
    const sheet = buildDetailsSheet({ seed, detail: null, history: null, availability: null });
    expect(sheet.header.title).toBe("Frieren");
    expect(sheet.header.score).toBe(8.9);
    expect(sheet.header.metaLine).toContain("★8.9");
    expect(sheet.cast.loading).toBe(true);
  });

  it("does not skeleton the synopsis when the seed already has it", () => {
    const sheet = buildDetailsSheet({
      seed: { ...seed, synopsis: "An elf mage from the seed." },
      detail: null,
      history: null,
      availability: null,
    });
    expect(sheet.synopsis.loading).toBe(false);
    expect(sheet.synopsis.text).toContain("from the seed");
  });

  it("fills gap sections from the fetched detail", () => {
    const detail = {
      id: "1",
      type: "series",
      title: "Frieren",
      synopsis: "An elf mage journeys.",
      genres: ["Adventure", "Fantasy"],
      studios: ["Madhouse"],
      episodeCount: 28,
      cast: [{ name: "Atsumi", kind: "voice" }],
      seasons: [{ season: 1, name: "S1", episodeCount: 28 }],
      trailerUrl: "https://yt/abc",
      externalLinks: [{ label: "MyAnimeList", url: "https://mal/1" }],
    } as unknown as TitleDetail;
    const sheet = buildDetailsSheet({ seed, detail, history: null, availability: null });
    expect(sheet.synopsis.loading).toBe(false);
    expect(sheet.synopsis.text).toContain("An elf mage");
    expect(sheet.facts.studio).toBe("Madhouse");
    expect(sheet.links.items).toEqual([{ label: "MyAnimeList", url: "https://mal/1" }]);
    expect(sheet.trailerUrl).toBe("https://yt/abc");
    expect(sheet.seasons.items).toHaveLength(1);
    expect(sheet.cast.names).toEqual(["Atsumi"]);
  });

  it("strips terminal control sequences from provider-controlled text", () => {
    const detail: TitleDetail = {
      id: "1",
      type: "series",
      title: "Frieren",
      synopsis: "Synopsis\x1b[2J with clears",
      genres: ["Adv\x07enture"],
      studios: ["Mad\x1b[31mhouse"],
      contentRating: "TV-14\x1b]8;;https://evil\x07",
      cast: [{ name: "Atsumi\x1b[H", kind: "voice" }],
      seasons: [{ season: 1, name: "S\x071", episodeCount: 28 }],
      externalLinks: [{ label: "MAL\x1b[8m", url: "https://mal/1" }],
    };
    const sheet = buildDetailsSheet({
      seed: { ...seed, title: "Frie\x1b]52;c;eA==\x07ren", year: "20\x0723" },
      detail,
      history: null,
      availability: null,
    });
    const hasControlChars = (value: string) =>
      [...value].some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x20 || (code >= 0x7f && code <= 0x9f);
      });
    expect(sheet.header.title).toBe("Frieren");
    expect(sheet.header.metaLine).toBe("Series · 2023 · ★8.9");
    expect(hasControlChars(sheet.header.metaLine)).toBe(false);
    expect(sheet.header.genres.every((genre) => !hasControlChars(genre))).toBe(true);
    expect(hasControlChars(sheet.synopsis.text)).toBe(false);
    expect(sheet.facts.studio).toBe("Madhouse");
    expect(sheet.facts.contentRating).toBe("TV-14");
    expect(sheet.cast.names).toEqual(["Atsumi"]);
    expect(sheet.seasons.items[0]?.label).toBe("S1");
    expect(hasControlChars(sheet.links.items[0]?.label ?? "")).toBe(false);
    expect(hasControlChars(sheet.links.items[0]?.url ?? "")).toBe(false);
  });

  it("builds the your-progress block from history", () => {
    const sheet = buildDetailsSheet({
      seed,
      detail: null,
      history: {
        season: 1,
        episode: 5,
        positionSeconds: 600,
        durationSeconds: 1400,
        completed: false,
      },
      availability: { providers: ["videasy"], offline: true, subs: ["en"] },
    });
    expect(sheet.your.progressLabel).toContain("S01E05");
    expect(sheet.your.providers).toEqual(["videasy"]);
    expect(sheet.your.offline).toBe(true);
  });
});
