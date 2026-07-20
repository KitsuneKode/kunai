import { describe, expect, test } from "bun:test";

import { bindingsForScope, formatChord, KEYBINDINGS, type KeyScope } from "@/app-shell/keybindings";

const SCOPES: KeyScope[] = [
  "global",
  "editing",
  "browse",
  "search",
  "loading",
  "library",
  "player",
  "postPlayback",
  "queue",
  "history",
  "notifications",
];

describe("keybinding collisions", () => {
  test.each(SCOPES)("no two live (non-helpOnly) bindings share a chord in scope %s", (scope) => {
    const seen = new Map<string, string>();
    for (const binding of bindingsForScope(scope)) {
      if (binding.helpOnly) continue;
      const chord = formatChord(binding.chord);
      const prior = seen.get(chord);
      expect(prior, `chord "${chord}" bound to both ${prior} and ${binding.id} in ${scope}`).toBe(
        undefined,
      );
      seen.set(chord, binding.id);
    }
  });

  test("every binding has a unique id", () => {
    const ids = KEYBINDINGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no new F or Shift+F binding for provider health reset", () => {
    const healthBindings = KEYBINDINGS.filter(
      (binding) =>
        binding.id.includes("reset-provider-health") ||
        binding.commandId === "reset-provider-health" ||
        binding.label.toLowerCase().includes("reset provider health"),
    );
    for (const binding of healthBindings) {
      expect(binding.chord.input?.toLowerCase() === "f").toBe(false);
    }
  });
});
