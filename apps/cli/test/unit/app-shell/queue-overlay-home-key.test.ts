import { describe, expect, test } from "bun:test";

import { matchBinding } from "@/app-shell/keybindings";
import type { LineEditorKey } from "@/app-shell/line-editor";

const ctrlG: LineEditorKey = { ctrl: true };

describe("Up Next does not treat ⌃G as queue reorder", () => {
  test("ctrl+g matches global home, not queue move-to-top", () => {
    expect(matchBinding("queue", "g", ctrlG)?.id).toBe("home");
    expect(matchBinding("queue", "g", { ...ctrlG, ctrl: false })?.id).toBe("queue-move-ends");
  });
});
