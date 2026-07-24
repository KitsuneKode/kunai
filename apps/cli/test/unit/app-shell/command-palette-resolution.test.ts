import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { buildCommandPickerModel, getHighlightedCommand } from "@/app-shell/shell-command-model";

function cmd(id: string, aliases: readonly string[], description: string): ResolvedAppCommand {
  return { id, label: id, aliases, description, enabled: true } as unknown as ResolvedAppCommand;
}

const COMMANDS = [
  cmd("continue", ["c", "continue"], "Open unfinished and recent watch progress"),
  cmd("calendar", ["calendar", "schedule"], "Anime and series release schedule"),
  cmd("recommendation", ["recommendation", "recommend"], "Personalized recommendations"),
];

function blockedCmd(id: string, aliases: readonly string[], reason: string): ResolvedAppCommand {
  return {
    id,
    label: id,
    aliases,
    description: id,
    enabled: false,
    reason,
  } as unknown as ResolvedAppCommand;
}

describe("context-blocked commands in the idle list", () => {
  const MIXED = [
    ...COMMANDS,
    blockedCmd("download", ["download"], "Select a search result first."),
    blockedCmd("bookmark", ["bookmark"], "Play or select a title first."),
  ];

  test("the idle palette lists only what can run right now", () => {
    const ids = buildCommandPickerModel("", MIXED, 0).options.map((option) => option.value);

    expect(ids).toContain("continue");
    expect(ids).not.toContain("download");
    expect(ids).not.toContain("bookmark");
  });

  test("searching still surfaces a blocked command with its reason", () => {
    // Dropping them from the idle list must not make them undiscoverable: a user
    // who types "download" has to find it and learn why it cannot run.
    const model = buildCommandPickerModel("download", MIXED, 0);
    const download = model.options.find((option) => option.value === "download");

    expect(download).toBeDefined();
    expect(download?.enabled).toBe(false);
    expect(download?.disabledReason).toBe("Select a search result first.");
  });

  test("an all-blocked context falls back to the full list, never an empty palette", () => {
    const allBlocked = [blockedCmd("download", ["download"], "nope")];

    expect(buildCommandPickerModel("", allBlocked, 0).options).toHaveLength(1);
  });
});

// The core invariant: the command Enter runs is ALWAYS the one the palette
// highlights (model.selectedOption). No separate resolution path may diverge.
test("getHighlightedCommand always equals the highlighted (rendered) row", () => {
  for (const input of ["", "c", "ca", "cal", "rec", "calendar"]) {
    for (let index = 0; index < COMMANDS.length; index += 1) {
      const model = buildCommandPickerModel(input, COMMANDS, index);
      const resolved = getHighlightedCommand(input, COMMANDS, index);
      expect(resolved?.id ?? null).toBe(model.selectedOption?.value ?? null);
    }
  }
});

// Regression: an exact single-letter alias ("c" → continue) must NOT override
// the row the user has navigated to.
test("exact alias does not override the navigated highlight", () => {
  const model = buildCommandPickerModel("c", COMMANDS, 1);
  const resolved = getHighlightedCommand("c", COMMANDS, 1);
  expect(resolved?.id).toBe(model.selectedOption?.value);
  // sanity: index 1 under query "c" is not the exact-alias command
  expect(model.selectedOption?.value).not.toBe("continue");
});

test("typing a partial query runs the best-ranked match at the default highlight", () => {
  const resolved = getHighlightedCommand("ca", COMMANDS, 0);
  expect(resolved?.id).toBe("calendar");
});
