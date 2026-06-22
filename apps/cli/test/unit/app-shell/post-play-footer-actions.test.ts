import { describe, expect, test } from "bun:test";

import { KEYBINDINGS, type KeyBinding } from "@/app-shell/keybindings";
import { buildPostPlayFooterActions } from "@/app-shell/post-play-footer-actions";

describe("buildPostPlayFooterActions", () => {
  test("derives did-not-start footer keys from the keybinding registry", () => {
    const bindings: readonly KeyBinding[] = KEYBINDINGS.map((binding) =>
      binding.id === "post-source" ? { ...binding, chord: { input: "z" } } : binding,
    );

    const actions = buildPostPlayFooterActions(
      { kind: "did-not-start" },
      {
        canResume: false,
        bindings,
      },
    );

    expect(actions.map((action) => `${action.key}:${action.action}`)).toEqual([
      "r:replay",
      "f:fallback",
      "z:source",
      "d:diagnostics",
      "s:search",
      "q:quit",
      "/:command-mode",
    ]);
  });

  test("builds dynamic mid-series session controls", () => {
    const actions = buildPostPlayFooterActions(
      { kind: "mid-series" },
      {
        canResume: true,
        autoplayPaused: true,
        autoskipPaused: false,
        stopAfterCurrent: true,
      },
    );

    expect(actions.map((action) => `${action.key}:${action.label}:${action.action}`)).toEqual([
      "n:continue:resume",
      "a:autoplay on:toggle-autoplay",
      "u:autoskip off:toggle-autoskip",
      "x:resume chain:stop-after-current",
      "o:source:source",
      "r:replay:replay",
      "/:commands:command-mode",
    ]);
  });

  test("season finale exposes next season through a registry-backed key", () => {
    const actions = buildPostPlayFooterActions(
      { kind: "season-finale", hasNextSeason: true },
      { canResume: false },
    );

    expect(actions[0]).toMatchObject({
      key: "n",
      label: "next season",
      action: "next-season",
      primary: true,
    });
  });
});
