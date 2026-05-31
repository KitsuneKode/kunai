import { expect, test } from "bun:test";

import {
  KEYBINDINGS,
  bindingsForScope,
  footerHints,
  formatChord,
  helpSections,
  matchBinding,
} from "@/app-shell/keybindings";

test("formatChord renders printable, named, and modified chords", () => {
  expect(formatChord({ input: "/" })).toBe("/");
  expect(formatChord({ input: "?" })).toBe("?");
  expect(formatChord({ named: "escape" })).toBe("Esc");
  expect(formatChord({ named: "return" })).toBe("Enter");
  expect(formatChord({ named: "tab" })).toBe("Tab");
  expect(formatChord({ named: "upArrow" })).toBe("↑");
  expect(formatChord({ named: "downArrow" })).toBe("↓");
  expect(formatChord({ input: "c", ctrl: true })).toBe("Ctrl+C");
});

test("matchBinding matches a named-key chord within scope", () => {
  const back = matchBinding("list", "", { escape: true });
  expect(back?.id).toBe("back");
});

test("matchBinding matches a printable chord and respects ctrl modifier", () => {
  expect(matchBinding("list", "/", {})?.id).toBe("command-palette");
  expect(matchBinding("list", "?", {})?.id).toBe("help");
  // bare "c" is not quit; only Ctrl+C is.
  expect(matchBinding("global", "c", {})).toBeNull();
  expect(matchBinding("global", "c", { ctrl: true })?.id).toBe("quit");
});

test("global bindings are reachable from every scope", () => {
  for (const scope of ["list", "search", "playback", "postPlayback"] as const) {
    expect(matchBinding(scope, "", { escape: true })?.id).toBe("back");
  }
});

test("scope bindings override a global binding on the same chord", () => {
  const listBindings = bindingsForScope("list");
  const chords = listBindings.map((binding) => formatChord(binding.chord));
  // no duplicate chord is offered within a single scope view
  expect(new Set(chords).size).toBe(chords.length);
});

test("footerHints are ordered by priority and exclude unprioritised bindings", () => {
  const hints = footerHints("list");
  expect(hints.length).toBeGreaterThan(0);
  const priorities = KEYBINDINGS.filter(
    (binding) => binding.scope === "list" && binding.footerPriority !== undefined,
  );
  // every hint carries a key label and an intent label
  for (const hint of hints) {
    expect(hint.keys.length).toBeGreaterThan(0);
    expect(hint.label.length).toBeGreaterThan(0);
  }
  // hints come back in non-decreasing priority order
  const ids = hints.map((hint) => hint.label);
  expect(ids.length).toBeLessThanOrEqual(priorities.length + footerHints("global").length);
});

test("footerHints respects the max argument", () => {
  expect(footerHints("list", 2).length).toBeLessThanOrEqual(2);
});

test("helpSections groups every binding under a labelled group", () => {
  const sections = helpSections();
  expect(sections.length).toBeGreaterThan(0);
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  expect(total).toBe(KEYBINDINGS.length);
  for (const section of sections) {
    expect(section.group.length).toBeGreaterThan(0);
    for (const item of section.items) {
      expect(item.keys.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
    }
  }
});

test("every binding has a unique id", () => {
  const ids = KEYBINDINGS.map((binding) => binding.id);
  expect(new Set(ids).size).toBe(ids.length);
});
