import { expect, test } from "bun:test";

import { setupFrameAt } from "../../harness/capture-setup";
import { frameWidth, stripAnsi } from "../../support/rendered-width";

for (const columns of [72, 80, 100, 140]) {
  test(`setup fits the padded app container at ${columns} columns`, () => {
    const frame = stripAnsi(setupFrameAt(0, columns));
    expect(frame).toContain("setup 1⁄7");
    expect(frame).toContain("[enter]");
    expect(frameWidth(frame)).toBeLessThanOrEqual(columns);
    // An overflowing horizontal border wraps its remaining cells onto a
    // second line. There should be precisely the two full frame dividers.
    const dividers = frame.split("\n").filter((line) => /^\s*─+\s*$/.test(line));
    expect(dividers).toHaveLength(2);
    expect(dividers.every((line) => line.trim().length === columns - 2)).toBe(true);
  });
}
