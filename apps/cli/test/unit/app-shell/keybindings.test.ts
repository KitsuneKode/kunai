import { expect, test } from "bun:test";

import { resolveBrowseMediaAction } from "@/app-shell/keybinding-runtime";
import {
  KEYBINDINGS,
  bindingForCommand,
  bindingKeys,
  bindingsForScope,
  buildFooterActionsFromBindings,
  commandBackedBindingsForScope,
  footerHints,
  footerKeyFromBinding,
  formatChord,
  helpSections,
  helpSectionsForScope,
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
  expect(formatChord({ input: "r", meta: true })).toBe("Alt+R");
});

test("matchBinding matches a named-key chord within scope", () => {
  const back = matchBinding("browse", "", { escape: true });
  expect(back?.id).toBe("back");
});

test("matchBinding matches a printable chord and respects ctrl modifier", () => {
  expect(matchBinding("browse", "/", {})?.id).toBe("command-palette");
  expect(matchBinding("browse", "?", {})?.id).toBe("help");
  // bare "c" is not quit; only Ctrl+C is.
  expect(matchBinding("global", "c", {})).toBeNull();
  expect(matchBinding("global", "c", { ctrl: true })?.id).toBe("quit");
});

test("matchBinding distinguishes Ctrl+R (refresh) from Alt+R (resume-seek)", () => {
  expect(matchBinding("player", "r", { ctrl: true })?.id).toBe("player-refresh");
  expect(matchBinding("player", "r", { meta: true })?.id).toBe("player-resume-seek");
  // bare "r" in the player is neither (replay is post-play).
  expect(matchBinding("player", "r", {})).toBeNull();
});

test("matchBinding skips documentation-only bindings", () => {
  // Ctrl+W is editing help text, owned by the line editor — never matched here.
  expect(matchBinding("editing", "w", { ctrl: true })).toBeNull();
  // ↑↓ browse nav is documented but owned by the list controller.
  expect(matchBinding("browse", "", { downArrow: true })).toBeNull();
});

test("global bindings are reachable from every scope", () => {
  for (const scope of ["browse", "search", "player", "postPlayback", "editing"] as const) {
    expect(matchBinding(scope, "", { escape: true })?.id).toBe("back");
  }
});

test("no duplicate rendered key within a single scope view", () => {
  for (const scope of ["browse", "search", "player", "postPlayback"] as const) {
    const keys = bindingsForScope(scope).map((binding) => bindingKeys(binding));
    expect(new Set(keys).size).toBe(keys.length);
  }
});

test("footerHints are ordered by priority and carry key + label", () => {
  const hints = footerHints("browse");
  expect(hints.length).toBeGreaterThan(0);
  for (const hint of hints) {
    expect(hint.keys.length).toBeGreaterThan(0);
    expect(hint.label.length).toBeGreaterThan(0);
  }
});

test("footerHints respects the max argument and excludes helpOnly", () => {
  expect(footerHints("browse", 2).length).toBeLessThanOrEqual(2);
  // browse-nav is helpOnly with no priority — never a footer hint.
  expect(footerHints("browse").some((hint) => hint.label.includes("Move through"))).toBe(false);
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

test("helpSectionsForScope returns only the chords live on the surface plus globals", () => {
  const playerSections = helpSectionsForScope("player");
  expect(playerSections.length).toBeGreaterThan(0);
  const playerItems = playerSections.flatMap((section) => section.items);
  // The scoped help matches the scoped binding set (own scope + globals).
  expect(playerItems.length).toBe(bindingsForScope("player").length);
  // Player-only chord shows up; an unrelated browse-only chord does not.
  expect(playerItems.some((item) => item.label.toLowerCase().includes("quality"))).toBe(true);
  expect(playerItems.some((item) => item.label.includes("Up Next"))).toBe(false);
  // Globals are always reachable, so the "back" chord is documented everywhere.
  expect(playerItems.some((item) => item.keys.toLowerCase().includes("esc"))).toBe(true);
});

test("helpSectionsForScope is narrower than the full registry", () => {
  const scopedTotal = helpSectionsForScope("postPlayback").reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  expect(scopedTotal).toBe(bindingsForScope("postPlayback").length);
  expect(scopedTotal).toBeLessThan(KEYBINDINGS.length);
});

test("player-scope bindings mirror the mpv bridge (k = quality, not streams)", () => {
  const quality = KEYBINDINGS.find((binding) => binding.id === "player-quality");
  expect(quality?.chord.input).toBe("k");
  expect(quality?.label.toLowerCase()).toContain("quality");
  // there is no bare "v" player binding (the old help panel invented one).
  expect(
    KEYBINDINGS.some((binding) => binding.scope === "player" && binding.chord.input === "v"),
  ).toBe(false);
});

test("buildFooterActionsFromBindings preserves display keys and appends the command tail", () => {
  const actions = buildFooterActionsFromBindings("queue", {
    ids: ["queue-play", "queue-reorder"],
    overrides: { "queue-play": { primary: true } },
  });

  expect(actions).toEqual([
    { key: "enter", label: "play", action: undefined, primary: true },
    { key: "J / K", label: "reorder", action: undefined, primary: undefined },
    { key: "/", label: "commands", action: "command-mode" },
    { key: "esc", label: "close", action: "quit" },
  ]);
});

test("matchBinding matches browse watchlist and follow chords", () => {
  expect(matchBinding("browse", "w", {})?.id).toBe("browse-watchlist");
  expect(matchBinding("browse", "W", { shift: true })?.id).toBe("browse-follow");
  expect(matchBinding("browse", "q", {})?.id).toBe("browse-queue");
});

test("bindingForCommand links stable slash commands to browse shortcuts", () => {
  expect(bindingForCommand("bookmark")?.id).toBe("browse-watchlist");
  expect(bindingForCommand("follow")?.id).toBe("browse-follow");
  expect(bindingForCommand("up-next")?.id).toBe("queue-open");
  expect(resolveBrowseMediaAction(bindingForCommand("bookmark")!)).toBe("add-to-watchlist");
  expect(resolveBrowseMediaAction(bindingForCommand("follow")!)).toBe("follow");
});

test("browse Up Next labels avoid legacy queue copy", () => {
  const queue = KEYBINDINGS.find((binding) => binding.id === "browse-queue");
  const historyQueue = KEYBINDINGS.find((binding) => binding.id === "history-queue");
  expect(queue?.label).toContain("Up Next");
  expect(historyQueue?.hintLabel).toBe("up next");
});

test("commandBackedBindingsForScope exposes browse parity bindings", () => {
  const ids = commandBackedBindingsForScope("browse").map((binding) => binding.id);
  expect(ids).toContain("browse-watchlist");
  expect(ids).toContain("browse-follow");
  expect(ids).toContain("browse-queue");
});

test("footerKeyFromBinding maps Enter chords to enter", () => {
  const play = KEYBINDINGS.find((binding) => binding.id === "queue-play");
  expect(play).toBeDefined();
  expect(footerKeyFromBinding(play!)).toBe("enter");
});

test("buildFooterActionsFromBindings can wire browse actions from the registry", () => {
  const actions = buildFooterActionsFromBindings("browse", {
    ids: ["browse-details-ctrl", "browse-download"],
    tail: false,
    actions: {
      "browse-details-ctrl": "details",
      "browse-download": "download",
    },
  });

  expect(actions.map((action) => `${action.key}:${action.label}:${action.action}`)).toEqual([
    "Ctrl+O:details:details",
    "Ctrl+D / d:download:download",
  ]);
});
