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
});
