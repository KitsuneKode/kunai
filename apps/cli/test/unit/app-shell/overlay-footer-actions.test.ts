import { describe, expect, test } from "bun:test";

import {
  historyFooterActions,
  notificationsFooterActions,
  queueFooterActions,
} from "@/app-shell/overlay-footer-actions";
import { selectFooterActions } from "@/app-shell/shell-primitives";

describe("overlay footer actions", () => {
  test("queue footer leads with play and always ends with commands + close", () => {
    const actions = queueFooterActions();

    expect(actions[0]).toMatchObject({ key: "enter", label: "play", primary: true });
    expect(actions.at(-2)).toMatchObject({ key: "/", label: "commands", action: "command-mode" });
    expect(actions.at(-1)).toMatchObject({ key: "esc", label: "close", action: "quit" });
  });

  test("history footer exposes resume, queue and filter hints", () => {
    expect(historyFooterActions().map((action) => action.label)).toEqual([
      "resume",
      "queue",
      "filter",
      "commands",
      "close",
    ]);
  });

  test("notifications footer carries inbox controls", () => {
    expect(notificationsFooterActions().map((action) => action.label)).toEqual([
      "action",
      "read",
      "archive",
      "delete",
      "switch",
      "commands",
      "close",
    ]);
  });

  test("display-only hint rows omit a router action so the keyboard router ignores them", () => {
    const hintRows = queueFooterActions().filter(
      (action) => action.label !== "commands" && action.label !== "close",
    );
    expect(hintRows.every((action) => action.action === undefined)).toBe(true);
  });

  test("narrow widths keep the footer to a couple hints plus the command tail", () => {
    const visible = selectFooterActions(queueFooterActions(), "detailed", 80);

    // width < 92 → 2 primary hints, then the command action tail.
    expect(visible.map((action) => action.label)).toEqual(["play", "reorder", "commands"]);
  });
});
