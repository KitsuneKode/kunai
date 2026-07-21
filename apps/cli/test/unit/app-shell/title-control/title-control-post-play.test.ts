import { describe, expect, test } from "bun:test";

import { KEYBINDINGS } from "@/app-shell/keybindings";
import { buildPostPlayFooterActions } from "@/app-shell/post-play-footer-actions";
import { buildPostPlayFooterActionsFromTitleControl } from "@/app-shell/title-control/title-control-post-play";

describe("buildPostPlayFooterActionsFromTitleControl", () => {
  test("matches legacy wrapper for did-not-start footers", () => {
    const fromTitleControl = buildPostPlayFooterActionsFromTitleControl(
      { kind: "did-not-start" },
      { canResume: false },
    );
    const legacy = buildPostPlayFooterActions({ kind: "did-not-start" }, { canResume: false });
    expect(fromTitleControl).toEqual(legacy);
  });

  test("derives keys from the keybinding registry", () => {
    const bindings = KEYBINDINGS.map((binding) =>
      binding.id === "post-source" ? { ...binding, chord: { input: "z" } } : binding,
    );
    const actions = buildPostPlayFooterActionsFromTitleControl(
      { kind: "did-not-start" },
      { canResume: false, bindings },
    );

    expect(actions.map((action) => `${action.key}:${action.action}`)).toEqual([
      "r:replay",
      "⇧F:fallback",
      "z:source",
      "d:diagnostics",
      "s:search",
      "m:menu",
      "q:quit",
      "/:command-mode",
    ]);
  });
});
