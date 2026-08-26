import { describe, expect, test } from "bun:test";

import { decodePlaybackTargetWebCode, encodePlaybackTargetShortCode } from "@kunai/types";

import { splitHeadline } from "../app/w/[code]/opengraph-image";
import { catalogFor, initialFor, positionFor, titleFor } from "../lib/share-presentation";

describe("splitHeadline", () => {
  test("a short title stays on one line", () => {
    expect(splitHeadline("Dune")).toEqual(["Dune"]);
    expect(splitHeadline("Attack on Titan")).toEqual(["Attack on Titan"]);
  });

  test("a long title balances across two lines instead of filling the first", () => {
    const [head, tail] = splitHeadline("Attack on Titan The Final Season Part 2");
    expect(tail).toBeDefined();
    // The point of balancing: neither line is a scrap.
    expect(Math.abs((head?.length ?? 0) - (tail?.length ?? 0))).toBeLessThan(10);
    expect(`${head} ${tail}`).toBe("Attack on Titan The Final Season Part 2");
  });

  test("a single unbroken word is cut rather than allowed to overflow", () => {
    const lines = splitHeadline("Supercalifragilisticexpialidocious");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 22)).toBe(true);
  });

  test("surrounding whitespace never becomes a line", () => {
    expect(splitHeadline("   Dune   ")).toEqual(["Dune"]);
  });
});

describe("share presentation is shared with the landing page", () => {
  const ref = {
    kind: "series",
    title: "Frieren",
    anchor: { by: "catalog", ns: "anilist", id: "154587" },
    season: 1,
    episode: 4,
  } as const;

  test("a round-tripped code presents the same title, position and catalog", () => {
    const code = encodePlaybackTargetShortCode(ref);
    expect(code).not.toBeNull();
    if (!code) return;

    const decoded = decodePlaybackTargetWebCode(code);
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(titleFor(decoded.ref)).toBe("Frieren");
    expect(positionFor(decoded.ref)).toBe("Season 1 · Episode 4");
    expect(catalogFor(decoded.ref)).toBe("ANILIST · 154587");
  });

  test("a damaged code decodes to null so the card can fall back", () => {
    expect(decodePlaybackTargetWebCode("not-a-real-code")).toBeNull();
  });

  test("initialFor survives a title that is only whitespace", () => {
    expect(initialFor("   ")).toBe("K");
  });
});
