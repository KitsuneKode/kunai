import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { resolveHighlightedPaletteRow } from "@/app-shell/shell-command-model";
import type { LocalTitleMatch } from "@/domain/palette/local-title-index";

function cmd(id: string, aliases: readonly string[], label: string): ResolvedAppCommand {
  // SAFETY: the public union resolver reads only id/label/aliases/description/enabled.
  return { id, label, aliases, description: id, enabled: true } as never;
}

function localTitle(title: string): LocalTitleMatch {
  return {
    entry: {
      titleId: `tmdb:${title.toLowerCase().replaceAll(" ", "-")}`,
      mediaKind: "movie",
      title,
      source: "history",
      detail: "history",
    },
    tier: 0,
    ranges: [],
  };
}

describe("shell v4 palette ranking contract", () => {
  test("/sm puts a local-title prefix before fuzzy commands", () => {
    const row = resolveHighlightedPaletteRow(
      "/sm",
      [cmd("history", ["history", "resume"], "History")],
      [localTitle("Smoke Movie")],
      0,
    );
    expect(row).toMatchObject({ kind: "title", match: { entry: { title: "Smoke Movie" } } });
  });

  test("an unmatched query exposes the catalog-search row when the host enables it", () => {
    expect(resolveHighlightedPaletteRow("frieren", [], [], 0, { catalogSearch: true })).toEqual({
      kind: "search",
      query: "frieren",
    });
  });
});
