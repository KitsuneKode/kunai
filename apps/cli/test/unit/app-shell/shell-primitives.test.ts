import { describe, expect, test } from "bun:test";

import { selectFooterActions } from "@/app-shell/shell-primitives";
import type { FooterAction } from "@/app-shell/types";

describe("selectFooterActions", () => {
  test("keeps command mode visible in minimal browse footers", () => {
    const actions: readonly FooterAction[] = [
      { key: "enter", label: "open", action: "search" },
      { key: "↑↓", label: "navigate", action: "details" },
      { key: "tab", label: "anime mode", action: "toggle-mode" },
      { key: "/", label: "commands", action: "command-mode" },
      { key: "ctrl+t", label: "trending", action: "trending" },
    ];

    expect(selectFooterActions(actions, "minimal").map((action) => action.action)).toEqual([
      "search",
      "details",
      "toggle-mode",
      "command-mode",
    ]);
  });

  test("drops disabled actions before picking minimal footer hints", () => {
    const actions: readonly FooterAction[] = [
      { key: "enter", label: "open", action: "search", disabled: true },
      { key: "/", label: "commands", action: "command-mode" },
      { key: "q", label: "quit", action: "quit" },
    ];

    expect(selectFooterActions(actions, "minimal").map((action) => action.action)).toEqual([
      "quit",
      "command-mode",
    ]);
  });

  test("keeps detailed footer compact when actions overflow", () => {
    const actions: readonly FooterAction[] = [
      { key: "/", label: "commands", action: "command-mode" },
      { key: "q", label: "stop", action: "quit" },
      { key: "n", label: "next", action: "next" },
      { key: "p", label: "previous", action: "previous" },
      { key: "a", label: "autoplay", action: "toggle-autoplay" },
      { key: "u", label: "autoskip", action: "toggle-autoskip" },
      { key: "e", label: "episodes", action: "pick-episode" },
      { key: "k", label: "streams", action: "streams" },
      { key: "o", label: "source", action: "source" },
      { key: "v", label: "quality", action: "quality" },
      { key: "r", label: "recover", action: "recover" },
    ];

    const selected = selectFooterActions(actions, "detailed", 120);

    expect(selected.length).toBeLessThanOrEqual(5);
    expect(
      selected.filter((action) => action.action !== "command-mode").length,
    ).toBeLessThanOrEqual(4);
    expect(selected.at(-1)?.action).toBe("command-mode");
    expect(selected.at(-1)?.label).toContain("more");
  });

  test("selectFooterActions preserves primary flag on first action", () => {
    const actions: readonly FooterAction[] = [
      { key: "enter", label: "play", action: "search", primary: true },
      { key: "/", label: "commands", action: "command-mode" },
      { key: "q", label: "quit", action: "quit" },
    ];
    const visible = selectFooterActions(actions, "detailed", 120);
    expect(visible.length).toBeGreaterThanOrEqual(2);
    expect(visible[0]?.primary).toBe(true);
    expect(visible[1]?.primary).toBeFalsy();
  });
});
