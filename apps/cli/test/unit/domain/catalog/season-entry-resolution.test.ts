import { describe, expect, test } from "bun:test";

import {
  resolveSeasonEntryId,
  type SeasonEntryGraph,
} from "@/domain/catalog/season-entry-resolution";
import type { TitleRelationEdge } from "@kunai/types";

function edge(
  kind: TitleRelationEdge["kind"],
  targetId: string,
  targetTitle?: string,
): TitleRelationEdge {
  return { kind, targetId, targetTitle, source: "anilist" };
}

function graph(
  entries: Array<{ id: string; title?: string; format?: string; edges: TitleRelationEdge[] }>,
): SeasonEntryGraph {
  return {
    nodes: new Map(entries.map((e) => [e.id, { title: e.title, format: e.format }])),
    edges: new Map(entries.map((e) => [e.id, e.edges])),
  };
}

/**
 * Attack on Titan on AniList — every hop is a SEQUEL edge, including the
 * "Part 2" continuations. Naive counting puts season 4 on "Season 3 Part 2".
 */
const AOT = graph([
  {
    id: "anilist:16498",
    title: "Attack on Titan",
    format: "TV",
    edges: [edge("sequel", "anilist:20958", "Attack on Titan Season 2")],
  },
  {
    id: "anilist:20958",
    title: "Attack on Titan Season 2",
    format: "TV",
    edges: [
      edge("prequel", "anilist:16498"),
      edge("sequel", "anilist:99147", "Attack on Titan Season 3"),
    ],
  },
  {
    id: "anilist:99147",
    title: "Attack on Titan Season 3",
    format: "TV",
    edges: [
      edge("prequel", "anilist:20958"),
      edge("sequel", "anilist:104578", "Attack on Titan Season 3 Part 2"),
    ],
  },
  {
    id: "anilist:104578",
    title: "Attack on Titan Season 3 Part 2",
    format: "TV",
    edges: [
      edge("prequel", "anilist:99147"),
      edge("sequel", "anilist:110277", "Attack on Titan Final Season"),
    ],
  },
  {
    id: "anilist:110277",
    title: "Attack on Titan Final Season",
    format: "TV",
    edges: [
      edge("prequel", "anilist:104578"),
      edge("sequel", "anilist:131681", "Attack on Titan Final Season Part 2"),
    ],
  },
  {
    id: "anilist:131681",
    title: "Attack on Titan Final Season Part 2",
    format: "TV",
    edges: [
      edge("prequel", "anilist:110277"),
      edge("sequel", "anilist:146984", "Attack on Titan Final Season Part 3"),
    ],
  },
  {
    id: "anilist:146984",
    title: "Attack on Titan Final Season Part 3",
    format: "TV",
    edges: [edge("prequel", "anilist:131681")],
  },
]);

describe("resolveSeasonEntryId — the sequel chain is not an ordinal", () => {
  test.each([
    [1, "anilist:16498"],
    [2, "anilist:20958"],
    [3, "anilist:99147"],
    [4, "anilist:110277"], // Final Season, NOT "Season 3 Part 2"
  ] as const)("AoT season %d → %s", (season, expected) => {
    // Any entry in the franchise can anchor the walk — pick S3P2 on purpose.
    expect(resolveSeasonEntryId(AOT, "anilist:104578", season)).toBe(expected);
  });

  test("AoT has no season 5 — the chain ending fails closed, not wrong", () => {
    expect(resolveSeasonEntryId(AOT, "anilist:16498", 5)).toBeUndefined();
  });

  test("Demon Slayer: arc-named entries resolve by graph position, movie skipped", () => {
    const kimetsu = graph([
      {
        id: "anilist:101922",
        title: "Demon Slayer",
        format: "TV",
        edges: [edge("sequel", "anilist:112151", "Mugen Train")],
      },
      {
        id: "anilist:112151",
        title: "Mugen Train",
        format: "MOVIE",
        edges: [
          edge("prequel", "anilist:101922"),
          edge("sequel", "anilist:129874", "Entertainment District Arc"),
        ],
      },
      {
        id: "anilist:129874",
        title: "Entertainment District Arc",
        format: "TV",
        edges: [
          edge("prequel", "anilist:112151"),
          edge("sequel", "anilist:145139", "Swordsmith Village Arc"),
        ],
      },
      {
        id: "anilist:145139",
        title: "Swordsmith Village Arc",
        format: "TV",
        edges: [edge("prequel", "anilist:129874")],
      },
    ]);
    // No text rule maps "Entertainment District Arc" to 2 — the graph does.
    expect(resolveSeasonEntryId(kimetsu, "anilist:101922", 2)).toBe("anilist:129874");
    expect(resolveSeasonEntryId(kimetsu, "anilist:101922", 3)).toBe("anilist:145139");
  });

  test("branching sequel edges fail closed rather than pick one", () => {
    const branched = graph([
      {
        id: "base",
        title: "Show",
        edges: [edge("sequel", "a", "Show Second"), edge("sequel", "b", "Show Spin-off")],
      },
      { id: "a", title: "Show Second", edges: [edge("prequel", "base")] },
      { id: "b", title: "Show Spin-off", edges: [edge("prequel", "base")] },
    ]);
    expect(resolveSeasonEntryId(branched, "base", 2)).toBeUndefined();
  });

  test("no graph coverage fails closed — never a title-string guess", () => {
    expect(
      resolveSeasonEntryId({ nodes: new Map(), edges: new Map() }, "unknown", 2),
    ).toBeUndefined();
  });

  test("non-integer and out-of-range seasons return undefined", () => {
    expect(resolveSeasonEntryId(AOT, "anilist:16498", 0)).toBeUndefined();
    expect(resolveSeasonEntryId(AOT, "anilist:16498", 2.5)).toBeUndefined();
  });
});
