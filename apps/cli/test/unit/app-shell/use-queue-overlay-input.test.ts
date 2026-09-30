import { describe, expect, test } from "bun:test";

import type { QueueViewRow } from "@/app-shell/queue-view";
import {
  handleQueueOverlayInput,
  queueConfirmPrompt,
  type QueueOverlayInputContext,
} from "@/app-shell/use-queue-overlay-input";

function row(id: string, title = `Title ${id}`): QueueViewRow {
  return {
    id,
    title,
    episodeLabel: "S01E01",
    sourceLabel: "local",
    state: "pending",
    position: 1,
    titleId: `t-${id}`,
  };
}

type Harness = {
  calls: string[];
  selection: number[];
  armedToken: string | null;
  press: (input: string, key?: Record<string, boolean>) => string;
};

function harness(options?: { rows?: readonly QueueViewRow[] }): Harness {
  const calls: string[] = [];
  const h: Harness = {
    calls,
    selection: [],
    armedToken: null,
    press: (input, key = {}) => {
      const ctx: QueueOverlayInputContext = {
        rows: options?.rows ?? [row("a"), row("b"), row("c")],
        selectedIndex: 0,
        setSelectedIndex: (update) => h.selection.push(update(0)),
        refresh: () => calls.push("refresh"),
        queueService: {
          moveDown: (id) => {
            calls.push(`moveDown:${id}`);
            return true;
          },
          moveUp: (id) => {
            calls.push(`moveUp:${id}`);
            return true;
          },
          moveToTop: (id) => calls.push(`top:${id}`),
          moveToBottom: (id) => calls.push(`bottom:${id}`),
          remove: (id) => calls.push(`remove:${id}`),
          clearPlayed: () => calls.push("clearPlayed"),
          clear: () => calls.push("clearAll"),
        },
        onPlayRow: (r) => calls.push(`play:${r.id}`),
        onRestore: () => calls.push("restore"),
        pressConfirm: (token) => {
          if (h.armedToken === token) {
            h.armedToken = null;
            return true;
          }
          h.armedToken = token;
          return false;
        },
        disarmConfirm: () => {
          h.armedToken = null;
        },
        pendingConfirmToken: h.armedToken,
      };
      return handleQueueOverlayInput(input, key, ctx);
    },
  };
  return h;
}

describe("handleQueueOverlayInput", () => {
  test("Enter claims the highlighted row for playback", () => {
    const h = harness();
    expect(h.press("", { return: true })).toBe("handled");
    expect(h.calls).toEqual(["play:a"]);
  });

  test("J/K reorder and track the moved row", () => {
    const h = harness();
    h.press("J");
    h.press("K");
    expect(h.calls).toEqual(["moveDown:a", "refresh", "moveUp:a", "refresh"]);
    expect(h.selection).toEqual([1, 0]);
  });

  test("g/G move the row to top and bottom", () => {
    const h = harness();
    h.press("g");
    h.press("G");
    expect(h.calls).toEqual(["top:a", "refresh", "bottom:a", "refresh"]);
  });

  test("x arms then removes on the matching second press", () => {
    const h = harness();
    h.press("x");
    expect(h.calls).toEqual([]);
    expect(h.armedToken).toBe("queue:remove:a");

    h.press("x");
    expect(h.calls).toEqual(["remove:a", "refresh"]);
    expect(h.armedToken).toBeNull();
  });

  test("moving selection re-arms x under the new row rather than confirming", () => {
    const h = harness();
    h.press("x");
    // Simulate the shell having moved selection to row b — the armed token
    // no longer matches, so this press must not delete row a.
    const armedCtx = {
      rows: [row("a"), row("b")],
      selectedIndex: 1,
      setSelectedIndex: () => {},
      refresh: () => h.calls.push("refresh"),
      queueService: {
        moveDown: () => false,
        moveUp: () => false,
        moveToTop: () => {},
        moveToBottom: () => {},
        remove: (id: string) => h.calls.push(`remove:${id}`),
        clearPlayed: () => {},
        clear: () => {},
      },
      onPlayRow: () => {},
      onRestore: () => {},
      pressConfirm: (token: string) => {
        if (h.armedToken === token) {
          h.armedToken = null;
          return true;
        }
        h.armedToken = token;
        return false;
      },
      disarmConfirm: () => {
        h.armedToken = null;
      },
      pendingConfirmToken: h.armedToken,
    };
    expect(handleQueueOverlayInput("x", {}, armedCtx)).toBe("handled");
    expect(h.calls).toEqual([]);
    expect(h.armedToken).toBe("queue:remove:b");
  });

  test("c clears all on the matching second press; C clears played", () => {
    const h = harness();
    h.press("c");
    expect(h.calls).toEqual([]);
    h.press("c");
    expect(h.calls).toEqual(["clearAll", "refresh"]);

    h.press("C");
    expect(h.armedToken).toBe("queue:clear-played");
    h.press("C");
    expect(h.calls).toEqual(["clearAll", "refresh", "clearPlayed", "refresh"]);
  });

  test("any non-confirm key cancels an armed press-again", () => {
    const h = harness();
    h.press("x");
    expect(h.armedToken).toBe("queue:remove:a");
    h.press("J");
    expect(h.armedToken).toBeNull();
    // The reorder still ran — the cancel does not swallow the key.
    expect(h.calls).toEqual(["moveDown:a", "refresh"]);
  });

  test("r restores and arrows fall through to generic navigation", () => {
    const h = harness();
    h.press("r");
    expect(h.calls).toEqual(["restore"]);
    expect(h.press("", { upArrow: true })).toBe("not-handled");
    expect(h.press("", { downArrow: true })).toBe("not-handled");
  });
});

describe("queueConfirmPrompt", () => {
  const view = {
    counts: { total: 3, unplayed: 2 },
    rows: [row("a", "Dune"), row("b"), row("c")],
  };

  test("names the armed destructive target", () => {
    expect(queueConfirmPrompt(null, view)).toBeNull();
    expect(queueConfirmPrompt("queue:clear-all", view)).toContain("clear 3 items");
    expect(queueConfirmPrompt("queue:clear-played", view)).toContain("clear 1 played");
    expect(queueConfirmPrompt("queue:remove:a", view)).toContain("remove Dune");
    // A stale token for a row that no longer exists still renders.
    expect(queueConfirmPrompt("queue:remove:gone", view)).toContain("this item");
  });
});
