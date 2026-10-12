import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import {
  movePaletteSelection,
  paletteSelectableCount,
  resolveHighlightedPaletteRow,
} from "@/app-shell/shell-command-model";
import type { LocalTitleMatch } from "@/domain/palette/local-title-index";

function cmd(id: string, aliases: readonly string[] = [id]): ResolvedAppCommand {
  // SAFETY: minimal command stub — the union model only reads id, label,
  // aliases and enabled from ResolvedAppCommand rows.
  return {
    id,
    label: id,
    aliases,
    description: id,
    enabled: true,
  } as never;
}

function titleMatch(titleId: string, title = titleId): LocalTitleMatch {
  return {
    entry: {
      titleId,
      mediaKind: "series",
      title,
      source: "history",
      detail: "history",
    },
    ranges: [[0, 2]],
  };
}

const COMMANDS = [cmd("trending"), cmd("history"), cmd("settings")];

const TITLES = [titleMatch("dune"), titleMatch("dune-part-two", "Dune Part Two")];

describe("resolveHighlightedPaletteRow", () => {
  test("command rows hold the low indices — a highlighted command always wins", () => {
    for (let index = 0; index < COMMANDS.length; index += 1) {
      const row = resolveHighlightedPaletteRow("", COMMANDS, TITLES, index);
      expect(row?.kind).toBe("command");
      expect(row?.kind === "command" ? row.command.id : null).toBe(COMMANDS[index]?.id ?? null);
    }
  });

  test("title rows occupy indices [commandCount, commandCount+titleCount)", () => {
    const commandCount = resolveHighlightedPaletteRow("", COMMANDS, [], 0) ? COMMANDS.length : 0;
    const first = resolveHighlightedPaletteRow("", COMMANDS, TITLES, commandCount);
    expect(first?.kind).toBe("title");
    expect(first?.kind === "title" ? first.match.entry.titleId : null).toBe("dune");
    const second = resolveHighlightedPaletteRow("", COMMANDS, TITLES, commandCount + 1);
    expect(second?.kind === "title" ? second.match.entry.titleId : null).toBe("dune-part-two");
  });

  test("out-of-range index resolves to null — Enter is a no-op", () => {
    expect(resolveHighlightedPaletteRow("", COMMANDS, TITLES, 999)).toBeNull();
  });

  test("an exact command match still resolves command, not a title", () => {
    const row = resolveHighlightedPaletteRow("trending", COMMANDS, TITLES, 0);
    expect(row?.kind).toBe("command");
    expect(row?.kind === "command" ? row.command.id : null).toBe("trending");
  });
});

describe("movePaletteSelection", () => {
  test("wraps around both ends", () => {
    expect(movePaletteSelection(4, 3, 1)).toBe(0);
    expect(movePaletteSelection(4, 0, -1)).toBe(3);
    expect(movePaletteSelection(4, 1, 1)).toBe(2);
  });

  test("clamps to zero when nothing is selectable", () => {
    expect(movePaletteSelection(0, 5, 1)).toBe(0);
  });
});

describe("paletteSelectableCount", () => {
  test("counts commands plus title rows", () => {
    expect(paletteSelectableCount("", COMMANDS, TITLES)).toBe(COMMANDS.length + TITLES.length);
    expect(paletteSelectableCount("", COMMANDS, [])).toBe(COMMANDS.length);
  });
});
