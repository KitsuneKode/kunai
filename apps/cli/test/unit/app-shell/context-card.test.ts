import { describe, expect, test } from "bun:test";

import {
  buildContextCardTile,
  buildPlaybackContextCards,
  clampContextCardText,
  contextCardGlyph,
} from "@/app-shell/primitives/ContextCard";

describe("ContextCard helpers", () => {
  test("builds stable initials, skipping connective stopwords", () => {
    expect(buildContextCardTile("Challengers of Science")).toBe("CS");
    expect(buildContextCardTile("DR. STONE")).toBe("DS");
    expect(buildContextCardTile("Frieren")).toBe("FR");
    expect(buildContextCardTile("")).toBe("??");
  });

  test("maps state tone to small context glyphs", () => {
    expect(contextCardGlyph({ kind: "next", stateTone: "success" })).toBe("▶");
    expect(
      contextCardGlyph({ kind: "previous", stateLabel: "watched", stateTone: "success" }),
    ).toBe("✓");
    expect(contextCardGlyph({ kind: "next", stateTone: "warning" })).toBe("◷");
    expect(contextCardGlyph({ kind: "next", stateTone: "danger" })).toBe("×");
    expect(contextCardGlyph({ kind: "related", stateTone: "muted" })).toBe("·");
  });

  test("clamps long text to the width with an ellipsis, never wrapping", () => {
    const out = clampContextCardText("A very long episode title that should not wrap", 18);
    expect(out.length).toBe(18);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("A very long")).toBe(true);
    expect(clampContextCardText("Short", 18)).toBe("Short");
  });

  test("builds next and previous context cards without huge labels", () => {
    const cards = buildPlaybackContextCards({
      nextEpisodeLabel: "E32 · Challengers of Science · 24m",
      previousEpisodeLabel: "E30 · Stone to Space · watched",
      hasNextEpisode: true,
      hasPreviousEpisode: true,
    });

    expect(cards.map((card) => card.kind)).toEqual(["next", "previous"]);
    expect(cards[0]?.stateTone).toBe("success");
    expect(cards[1]?.stateLabel).toBe("watched");
  });
});
