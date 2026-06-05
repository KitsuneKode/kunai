import { expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { buildCommandPickerModel, getHighlightedCommand } from "@/app-shell/shell-command-ui";

function cmd(id: string, aliases: readonly string[], description: string): ResolvedAppCommand {
  return { id, label: id, aliases, description, enabled: true } as unknown as ResolvedAppCommand;
}

const COMMANDS = [
  cmd("continue", ["c", "continue"], "Open unfinished and recent watch progress"),
  cmd("calendar", ["calendar", "schedule"], "Anime and series release schedule"),
  cmd("recommendation", ["recommendation", "recommend"], "Personalized recommendations"),
];

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
