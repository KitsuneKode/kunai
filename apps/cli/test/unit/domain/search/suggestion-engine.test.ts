import { describe, expect, test } from "bun:test";

import {
  buildSuggestionBand,
  ghostCompletionSuffix,
  rankSuggestions,
  scoreSuggestion,
  shouldShowSuggestionBand,
  SUGGESTION_EMPTY_HINT,
  type SearchSuggestion,
} from "@/domain/search/suggestion-engine";

function suggestion(
  id: string,
  title: string,
  extra: Partial<SearchSuggestion> = {},
): SearchSuggestion {
  return { id, title, source: "catalog", ...extra };
}

// ---------------------------------------------------------------------------
// scoreSuggestion — tier ordering
// ---------------------------------------------------------------------------

describe("scoreSuggestion", () => {
  test("prefix beats word-boundary beats subsequence", () => {
    const prefix = scoreSuggestion("dun", "Dune")!;
    const boundary = scoreSuggestion("dun", "Arrakis: Dune")!;
    const subseq = scoreSuggestion("dun", "Dragon Under Stars")!;

    expect(prefix.score).toBeGreaterThan(boundary.score);
    expect(boundary.score).toBeGreaterThan(subseq.score);
  });

  test("prefix match indices cover the typed run", () => {
    expect(scoreSuggestion("dun", "Dune")!.matchIndices).toEqual([0, 1, 2]);
  });

  test("word-boundary match indices point at the interior run", () => {
    const match = scoreSuggestion("dun", "Arrakis: Dune")!;
    expect(match.matchIndices).toEqual([9, 10, 11]);
  });

  test("mid-word contiguous substring falls to the subsequence tier", () => {
    const midWord = scoreSuggestion("une", "Dune")!;
    const boundary = scoreSuggestion("une", "The Une")!;
    expect(midWord.score).toBeLessThan(boundary.score);
  });

  test("returns null when the subsequence cannot complete", () => {
    expect(scoreSuggestion("dzz", "Dune")).toBeNull();
    expect(scoreSuggestion("dune dune", "Dune")).toBeNull();
  });

  test("accent folds and case-insensitive", () => {
    expect(scoreSuggestion("ame", "Amélie")).not.toBeNull();
    expect(scoreSuggestion("AME", "Amélie")!.matchIndices).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// rankSuggestions — ordering + tiebreaks
// ---------------------------------------------------------------------------

describe("rankSuggestions", () => {
  test("orders prefix > word-boundary > subsequence rows", () => {
    const ranked = rankSuggestions(
      "dun",
      [
        suggestion("subseq", "Dragon Under Stars"),
        suggestion("boundary", "Arrakis: Dune"),
        suggestion("prefix", "Dune"),
      ],
      10,
    );

    expect(ranked.map((entry) => entry.suggestion.id)).toEqual(["prefix", "boundary", "subseq"]);
  });

  test("recency breaks equal-score ties — newer first", () => {
    // Equal-length titles score identically, so only the timestamp separates them.
    const ranked = rankSuggestions(
      "dun",
      [
        suggestion("old", "Dune A", { recencyMs: 1000 }),
        suggestion("new", "Dune B", { recencyMs: 9000 }),
      ],
      10,
    );

    expect(ranked.map((entry) => entry.suggestion.id)).toEqual(["new", "old"]);
  });

  test("shorter prefix titles still beat a more recent longer title", () => {
    // The tight-prefix bonus outranks recency — a closer title wins the tie.
    const ranked = rankSuggestions(
      "dun",
      [
        suggestion("loose", "Dune Messiah", { recencyMs: 9000 }),
        suggestion("tight", "Dune", { recencyMs: 1000 }),
      ],
      10,
    );
    expect(ranked.map((entry) => entry.suggestion.id)).toEqual(["tight", "loose"]);
  });

  test("deterministic id order when score and recency tie", () => {
    const ranked = rankSuggestions("dun", [suggestion("b", "Dune"), suggestion("a", "Dune")], 10);

    expect(ranked.map((entry) => entry.suggestion.id)).toEqual(["a", "b"]);
  });

  test("limit caps the result list", () => {
    const ranked = rankSuggestions(
      "a",
      [suggestion("1", "Apple"), suggestion("2", "Armor"), suggestion("3", "Ash")],
      2,
    );
    expect(ranked.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildSuggestionBand — grouping, dedup, skeletons, honest empty
// ---------------------------------------------------------------------------

describe("buildSuggestionBand", () => {
  const local = (id: string, title: string): SearchSuggestion => ({
    id,
    title,
    source: "watched",
    badge: "watched",
  });
  const remote = (id: string, title: string): SearchSuggestion =>
    suggestion(`catalog:${id}`, title);

  test("groups local under its header and catalog under theirs", () => {
    const model = buildSuggestionBand({
      query: "du",
      local: [local("l1", "Dune")],
      remote: [remote("r1", "Dune Messiah")],
      remotePending: false,
    });

    expect(model.rows.map((row) => row.kind)).toEqual(["header", "item", "header", "item"]);
    expect(model.items.length).toBe(2);
  });

  test("catalog rows repeating a shown local title are deduped", () => {
    const model = buildSuggestionBand({
      query: "du",
      local: [local("l1", "Dune")],
      remote: [remote("r1", "Dune"), remote("r2", "Dune Part Two")],
      remotePending: false,
    });

    expect(model.items.map((entry) => entry.suggestion.id)).toEqual(["l1", "catalog:r2"]);
  });

  test("catalog dedupe is accent/case-folded", () => {
    const model = buildSuggestionBand({
      query: "ame",
      local: [local("l1", "Amelie")],
      remote: [remote("r1", "Amélie")],
      remotePending: false,
    });
    expect(model.items.length).toBe(1);
    expect(model.items[0]?.suggestion.id).toBe("l1");
  });

  test("pending remote paints skeleton rows under the catalog header", () => {
    const model = buildSuggestionBand({
      query: "du",
      local: [local("l1", "Dune")],
      remote: [],
      remotePending: true,
    });

    const kinds = model.rows.map((row) => row.kind);
    expect(kinds).toEqual(["header", "item", "header", "skeleton", "skeleton"]);
    expect(model.items.length).toBe(1);
  });

  test("all-empty and settled shows the honest hint row", () => {
    const model = buildSuggestionBand({
      query: "dune",
      local: [],
      remote: [],
      remotePending: false,
    });
    expect(model.rows).toEqual([{ kind: "hint", label: SUGGESTION_EMPTY_HINT }]);
    expect(model.items.length).toBe(0);
  });

  test("a non-matching remote title still renders (the catalog ranked it)", () => {
    // The catalog can fuzzy-match things our scorer rejects (e.g. alias hits);
    // they stay, with no highlight indices, rather than vanishing mid-flight.
    const model = buildSuggestionBand({
      query: "dune",
      local: [],
      remote: [remote("r1", "Le désert de l'arrakis")],
      remotePending: false,
    });
    expect(model.items.length).toBe(1);
    expect(model.items[0]?.matchIndices).toEqual([]);
  });

  test("custom remoteHeader overrides default Catalog label", () => {
    const model = buildSuggestionBand({
      query: "yt",
      local: [],
      remote: [remote("r1", "YouTube Gaming")],
      remotePending: false,
      remoteHeader: "YouTube Suggestions",
    });
    const header = model.rows.find((r) => r.kind === "header");
    expect(header).toEqual({ kind: "header", label: "YouTube Suggestions" });
  });

  test("local section is capped so catalog keeps its rows", () => {
    const model = buildSuggestionBand({
      query: "a",
      local: [local("l1", "Apple"), local("l2", "Armor"), local("l3", "Ash"), local("l4", "Atlas")],
      remote: [remote("r1", "Arrival"), remote("r2", "Amelie")],
      remotePending: false,
      localCap: 3,
    });
    const locals = model.items.filter((entry) => entry.suggestion.id.startsWith("l"));
    const remotes = model.items.filter((entry) => entry.suggestion.id.startsWith("catalog:"));
    expect(locals.length).toBe(3);
    expect(remotes.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// shouldShowSuggestionBand — the visibility contract
// ---------------------------------------------------------------------------

describe("shouldShowSuggestionBand", () => {
  const base = {
    query: "du",
    submittedQuery: "",
    commandMode: false,
    calendarView: false,
    ultraCompact: false,
    overlayActive: false,
    searching: false,
    dismissedForQuery: null,
  };

  test("visible for a fresh draft at min length", () => {
    expect(shouldShowSuggestionBand(base)).toBe(true);
  });

  test("hidden below the min draft length", () => {
    expect(shouldShowSuggestionBand({ ...base, query: "d" })).toBe(false);
  });

  test("hidden when the draft equals the submitted query", () => {
    expect(shouldShowSuggestionBand({ ...base, query: "dune", submittedQuery: "dune" })).toBe(
      false,
    );
  });

  test("hidden in command mode, calendar, ultra-compact, overlays, and loading", () => {
    for (const flag of [
      "commandMode",
      "calendarView",
      "ultraCompact",
      "overlayActive",
      "searching",
    ] as const) {
      expect(shouldShowSuggestionBand({ ...base, [flag]: true })).toBe(false);
    }
  });

  test("dismissal sticks to the exact draft and lifts on the next keystroke", () => {
    expect(shouldShowSuggestionBand({ ...base, dismissedForQuery: "du" })).toBe(false);
    expect(shouldShowSuggestionBand({ ...base, query: "dun", dismissedForQuery: "du" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ghostCompletionSuffix
// ---------------------------------------------------------------------------

describe("ghostCompletionSuffix", () => {
  test("returns the remaining tail for a case-insensitive prefix", () => {
    expect(ghostCompletionSuffix("dun", "Dune")).toBe("e");
    expect(ghostCompletionSuffix("dun", "Dune Part Two")).toBe("e Part Two");
  });

  test("no ghost for non-prefix or complete titles", () => {
    expect(ghostCompletionSuffix("une", "Dune")).toBeNull();
    expect(ghostCompletionSuffix("dune", "Dune")).toBeNull();
    expect(ghostCompletionSuffix("", "Dune")).toBeNull();
  });

  test("slices on code points, not UTF-16 units", () => {
    expect(ghostCompletionSuffix("de", "Déjà Vu")).toBe("jà Vu");
  });
});
