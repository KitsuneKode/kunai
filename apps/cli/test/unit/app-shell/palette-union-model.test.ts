import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { buildPaletteRows, defaultPaletteSelectionIndex } from "@/app-shell/palette-ranking";
import {
  movePaletteSelection,
  paletteSelectableCount,
  resolveHighlightedPaletteRow,
} from "@/app-shell/shell-command-model";
import type { LocalTitleMatch } from "@/domain/palette/local-title-index";

function cmd(id: string, aliases: readonly string[] = [id], label = id): ResolvedAppCommand {
  // SAFETY: the ranking tests need only id/label/aliases/description/enabled;
  // the remaining command-registry fields are irrelevant to this pure model.
  return {
    id,
    label,
    aliases,
    description: id,
    enabled: true,
  } as never;
}

function titleMatch(title: string, tier: 0 | 1 | 2 = 0): LocalTitleMatch {
  return {
    entry: {
      titleId: `tmdb:${title.toLowerCase().replaceAll(" ", "-")}`,
      mediaKind: "movie",
      title,
      source: "history",
      detail: "history",
    },
    tier,
    ranges: [],
  };
}

describe("palette ranking tiers", () => {
  test("a local-title prefix beats fuzzy commands for /sm", () => {
    const commands = [
      cmd("history", ["history", "resume", "recent"], "History"),
      cmd("settings", ["settings", "config"], "Settings"),
    ];
    const rows = buildPaletteRows("/sm", commands, [titleMatch("Smoke Movie")]);

    expect(rows[0]).toMatchObject({ kind: "title", match: { entry: { title: "Smoke Movie" } } });
    expect(rows.slice(1).map((row) => row.kind)).toEqual(["command"]);
    expect(rows[1]).toMatchObject({ kind: "command", command: { id: "history" } });
  });

  test("exact commands, command prefixes, title prefixes, fuzzy commands, fuzzy titles", () => {
    const rows = buildPaletteRows(
      "ser",
      [
        cmd("series-mode", ["series-mode", "series"], "Series Mode"),
        cmd("ser", ["ser"], "Ser"),
        cmd("laser", ["laser"], "Laser"),
      ],
      [titleMatch("Series Smoke"), titleMatch("sERendipity", 2)],
    );

    expect(rows.map((row) => row.kind)).toEqual(["command", "command", "title", "title"]);
    expect(rows[0]).toMatchObject({ command: { id: "ser" } });
    expect(rows[1]).toMatchObject({ command: { id: "series-mode" } });
    expect(rows[2]).toMatchObject({ match: { entry: { title: "Series Smoke" } } });
    expect(rows.some((row) => row.kind === "command" && row.command.label === "Laser")).toBe(false);
    expect(rows[3]).toMatchObject({ match: { entry: { title: "sERendipity" } } });
  });

  test("catalog search is last when fuzzy matches exist and absent after a prefix match", () => {
    const fuzzyOnly = buildPaletteRows(
      "sm",
      [cmd("history", ["history", "resume"], "History")],
      [],
      { catalogSearch: true },
    );
    expect(fuzzyOnly.at(-1)).toEqual({ kind: "search", query: "sm" });
    expect(fuzzyOnly[0]?.kind).toBe("command");

    const prefixed = buildPaletteRows("smo", [], [titleMatch("Smoke Movie")], {
      catalogSearch: true,
    });
    expect(prefixed.some((row) => row.kind === "search")).toBe(false);
  });
});

describe("resolveHighlightedPaletteRow", () => {
  const commands = [cmd("history", ["history", "resume"], "History")];
  const titles = [titleMatch("Smoke Movie")];

  test("resolves the exact row occupying the unified index", () => {
    expect(resolveHighlightedPaletteRow("/sm", commands, titles, 0)).toMatchObject({
      kind: "title",
      match: { entry: { title: "Smoke Movie" } },
    });
    expect(resolveHighlightedPaletteRow("/sm", commands, titles, 1)).toMatchObject({
      kind: "command",
      command: { id: "history" },
    });
  });

  test("resolves the catalog-search row only when the host enables it", () => {
    expect(resolveHighlightedPaletteRow("frieren", [], [], 0, { catalogSearch: true })).toEqual({
      kind: "search",
      query: "frieren",
    });
    expect(resolveHighlightedPaletteRow("frieren", [], [], 0)).toBeNull();
  });

  test("the fallback owns initial Enter while fuzzy rows remain reachable", () => {
    const fuzzyCommands = [cmd("history", ["history", "resume"], "History")];
    expect(defaultPaletteSelectionIndex("sm", fuzzyCommands, [], { catalogSearch: true })).toBe(1);
    expect(defaultPaletteSelectionIndex("his", fuzzyCommands, [], { catalogSearch: true })).toBe(0);
  });

  test("counts the unified rows a host renders", () => {
    expect(paletteSelectableCount("/sm", commands, titles)).toBe(2);
    expect(paletteSelectableCount("frieren", [], [], { catalogSearch: true })).toBe(1);
  });

  test("idle input is command-only because local titles never match an empty query", () => {
    expect(paletteSelectableCount("", commands, titles)).toBe(commands.length);
  });
});

describe("movePaletteSelection", () => {
  test("wraps around both ends and clamps empty models to zero", () => {
    expect(movePaletteSelection(4, 0, -1)).toBe(3);
    expect(movePaletteSelection(4, 3, 1)).toBe(0);
    expect(movePaletteSelection(0, 2, 1)).toBe(0);
  });
});
