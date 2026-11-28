import { describe, expect, test } from "bun:test";

import { KannaLine } from "@/app-shell/primitives/KannaLine";
import React from "react";

import { render, stripAnsi } from "../../harness/render-capture";

describe("KannaLine", () => {
  test("truncates instead of wrapping into a 40-column footer", () => {
    const handle = render(
      <KannaLine line="checking which mirrors are awake, then choosing the calmest path" />,
      { columns: 40, rows: 20 },
    );
    const frame = stripAnsi(handle.lastFrame() ?? "");
    const lines = frame.split("\n").filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.trimEnd().length).toBeLessThanOrEqual(40);
    expect(lines[0]).toContain("…");
    handle.unmount();
  });
});
