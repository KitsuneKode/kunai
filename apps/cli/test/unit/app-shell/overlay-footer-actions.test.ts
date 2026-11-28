import { describe, expect, test } from "bun:test";

import {
  historyFooterActions,
  notificationsFooterActions,
  queueFooterActions,
  tracksFooterActions,
} from "@/app-shell/overlay-footer-actions";
import { selectFooterActions } from "@/app-shell/shell-primitives";

describe("overlay footer actions", () => {
  test("queue footer leads with play and always ends with commands + close", () => {
    const actions = queueFooterActions();

    expect(actions[0]).toMatchObject({ key: "enter", label: "play", primary: true });
    expect(actions[1]).toMatchObject({ key: "J / K", label: "reorder" });
    expect(actions.at(-2)).toMatchObject({ key: "/", label: "commands", action: "command-mode" });
    expect(actions.at(-1)).toMatchObject({ key: "esc", label: "close", action: "quit" });
  });

  test("history footer exposes resume, actions, queue and tab hints", () => {
    expect(historyFooterActions().map((action) => action.label)).toEqual([
      "resume",
      "actions",
      "up next",
      "tabs",
      "commands",
      "close",
    ]);
  });

  test("notifications footer on Active with pagination carries the inbox grammar", () => {
    const actionPairs = notificationsFooterActions({ tab: "active", paginated: true }).map(
      (action) => `${action.key}:${action.label}`,
    );

    expect(actionPairs).toEqual([
      "enter:act",
      "a:actions",
      "s:sort",
      "Tab:archive",
      "[ / ]:page",
      "/:commands",
      "esc:close",
    ]);
  });

  test("notifications footer on Archive without pagination flips the tab label and drops paging", () => {
    const actionPairs = notificationsFooterActions({ tab: "archive", paginated: false }).map(
      (action) => `${action.key}:${action.label}`,
    );

    expect(actionPairs).toEqual([
      "enter:act",
      "a:actions",
      "s:sort",
      "Tab:active",
      "/:commands",
      "esc:close",
    ]);
  });

  test("display-only hint rows omit a router action so the keyboard router ignores them", () => {
    const hintRows = queueFooterActions().filter(
      (action) => action.label !== "commands" && action.label !== "close",
    );
    expect(hintRows.every((action) => action.action === undefined)).toBe(true);
  });

  test("empty overlay lists keep only actions that do not need a selection", () => {
    // Restore brings back the last queue, so it is the one useful key on an
    // empty Up Next and must survive the empty-list filter.
    expect(queueFooterActions({ hasRows: false }).map((action) => action.label)).toEqual([
      "restore",
      "commands",
      "close",
    ]);
    expect(historyFooterActions({ hasRows: false }).map((action) => action.label)).toEqual([
      "tabs",
      "commands",
      "close",
    ]);
    expect(
      notificationsFooterActions({ tab: "active", paginated: false }, false).map(
        (action) => action.label,
      ),
    ).toEqual(["sort", "archive", "commands", "close"]);
  });

  test("tracks footer always exposes pane movement and gates switch on real alternatives", () => {
    expect(
      tracksFooterActions({ hasSwitchable: true, sourceSectionActive: true }).map(
        (action) => `${action.key}:${action.label}`,
      ),
    ).toEqual(["↑↓:choose", "←→:pane", "enter:switch", "f:favorite", "/:commands", "esc:back"]);
    expect(
      tracksFooterActions({ hasSwitchable: false, sourceSectionActive: false }).map(
        (action) => action.label,
      ),
    ).toEqual(["choose", "pane", "commands", "back"]);
  });

  test("narrow widths keep the footer to a couple hints plus the command tail", () => {
    const visible = selectFooterActions(queueFooterActions(), "detailed", 80);

    // width < 92 → 2 primary hints, then the command action tail.
    expect(visible.map((action) => action.label)).toEqual(["play", "reorder", "commands"]);
  });
});
