import { describe, expect, test } from "bun:test";

import {
  dedupeLocalTitleEntries,
  LOCAL_TITLE_MATCH_LIMIT,
  localTitleLane,
  matchLocalTitles,
  normalizeTitleKey,
  type LocalTitleEntry,
} from "@/domain/palette/local-title-index";

function entry(partial: Partial<LocalTitleEntry> & { title: string }): LocalTitleEntry {
  return {
    titleId: partial.titleId ?? `id:${partial.title}`,
    mediaKind: partial.mediaKind ?? "series",
    title: partial.title,
    source: partial.source ?? "history",
    providerId: partial.providerId,
    recency: partial.recency,
    detail: partial.detail ?? "",
    season: partial.season,
    episode: partial.episode,
    absoluteEpisode: partial.absoluteEpisode,
    externalIds: partial.externalIds,
    historyEntry: partial.historyEntry,
    queueEntryId: partial.queueEntryId,
    contentType: partial.contentType,
  };
}

describe("normalizeTitleKey", () => {
  test("folds case, punctuation, and diacritics into a stable key", () => {
    expect(normalizeTitleKey("Pokémon: The Series")).toBe(normalizeTitleKey("pokemon the series"));
    expect(normalizeTitleKey("Re:Zero -Starting Life-")).toBe(
      normalizeTitleKey("re zero starting life"),
    );
    expect(normalizeTitleKey("  STEINS;GATE  ")).toBe("steins gate");
  });
});

describe("dedupeLocalTitleEntries", () => {
  test("keeps the first writer per normalized title — callers feed sources in precedence order", () => {
    const deduped = dedupeLocalTitleEntries([
      entry({ title: "Dune", source: "history", titleId: "h1", detail: "history" }),
      entry({ title: "Dune!", source: "followed", titleId: "f1", detail: "following" }),
      entry({ title: "Dune", source: "list", titleId: "l1" }),
      entry({ title: "Dune Part Two", source: "list", titleId: "l2" }),
    ]);

    expect(deduped.map((row) => row.titleId)).toEqual(["h1", "l2"]);
    expect(deduped[0]?.source).toBe("history");
  });

  test("drops rows whose title normalizes to nothing", () => {
    const deduped = dedupeLocalTitleEntries([entry({ title: "///" }), entry({ title: "Dune" })]);
    expect(deduped).toHaveLength(1);
  });
});

describe("matchLocalTitles ordering", () => {
  const entries = [
    entry({ title: "Dune Prophecy", titleId: "prefix" }),
    entry({ title: "Children of Dune", titleId: "word-boundary" }),
    entry({ title: "Denis Unearthed", titleId: "subsequence" }),
    entry({ title: "Bleach", titleId: "unrelated" }),
  ];

  test("prefix beats word-boundary beats subsequence", () => {
    const matches = matchLocalTitles(entries, "du");
    expect(matches.map((match) => match.entry.titleId)).toEqual([
      "prefix",
      "word-boundary",
      "subsequence",
    ]);
  });

  test("subsequence match needs every query char in order", () => {
    // "dn" hits all three via subsequence — none start with it — and a query
    // whose chars never appear in order matches nothing at all.
    expect(
      matchLocalTitles(entries, "dn")
        .map((match) => match.entry.titleId)
        .sort(),
    ).toEqual(["prefix", "subsequence", "word-boundary"].sort());
    expect(matchLocalTitles(entries, "zzz")).toEqual([]);
  });

  test("diacritics fold — pokemon matches Pokémon", () => {
    const matches = matchLocalTitles([entry({ title: "Pokémon Origins" })], "pok");
    expect(matches).toHaveLength(1);
    // The accent lands on the ORIGINAL characters, including the accented é.
    expect(matches[0]?.ranges).toEqual([[0, 3]]);
  });

  test("recency breaks ties inside a tier", () => {
    const stale = entry({ title: "Dune Alpha", titleId: "stale", recency: 10 });
    const fresh = entry({ title: "Dune Beta", titleId: "fresh", recency: 20 });
    const matches = matchLocalTitles([stale, fresh], "dune");
    expect(matches.map((match) => match.entry.titleId)).toEqual(["fresh", "stale"]);
  });
});

describe("matchLocalTitles section rules", () => {
  const entries = [entry({ title: "Dune" })];

  test("empty and single-character queries collapse the title section entirely", () => {
    expect(matchLocalTitles(entries, "")).toEqual([]);
    expect(matchLocalTitles(entries, "/")).toEqual([]);
    expect(matchLocalTitles(entries, "d")).toEqual([]);
    expect(matchLocalTitles(entries, "du")).toHaveLength(1);
  });

  test("a leading palette slash is ignored for matching", () => {
    expect(matchLocalTitles(entries, "/du")).toHaveLength(1);
  });

  test("results cap at the section limit", () => {
    const many = Array.from({ length: LOCAL_TITLE_MATCH_LIMIT + 4 }, (_, i) =>
      entry({ title: `Dune ${i}`, titleId: `d${i}` }),
    );
    expect(matchLocalTitles(many, "dune")).toHaveLength(LOCAL_TITLE_MATCH_LIMIT);
  });

  test("match ranges point into the original title for accent rendering", () => {
    const [match] = matchLocalTitles([entry({ title: "Vinland Saga" })], "vin");
    expect(match?.ranges).toEqual([[0, 3]]);
    const [word] = matchLocalTitles([entry({ title: "Vinland Saga" })], "sag");
    expect(word?.ranges).toEqual([[8, 11]]);
  });
});

describe("localTitleLane", () => {
  test("lane follows the row's media kind for provider routing", () => {
    expect(localTitleLane(entry({ title: "x", mediaKind: "anime" }))).toBe("anime");
    expect(localTitleLane(entry({ title: "x", mediaKind: "series" }))).toBe("series");
    expect(localTitleLane(entry({ title: "x", mediaKind: "movie" }))).toBe("series");
    expect(localTitleLane(entry({ title: "x", mediaKind: "video" }))).toBe("youtube");
  });
});
