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
      "m:menu",
      "q:quit",
      "/:command-mode",
    ]);
  });

  test("keeps mid-series footer glanceable by demoting toggles to the palette", () => {
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
      "n:resume:resume",
      "o:source:source",
      "r:replay:replay",
      "m:menu:menu",
      "/:commands:command-mode",
    ]);

    const toggleActions = actions.filter(
      (action) =>
        action.action === "toggle-autoplay" ||
        action.action === "toggle-autoskip" ||
        action.action === "stop-after-current",
    );
    expect(toggleActions).toHaveLength(0);
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
