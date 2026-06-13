import { expect, test } from "bun:test";

import { SectionGroup } from "@/app-shell/primitives/SectionGroup";
import { Box } from "ink";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Build the ESC matcher without a literal control char (oxlint no-control-regex).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function frameLines(node: React.ReactElement): string[] {
  return captureFrame(node, { columns: 100 }).replace(ANSI, "").split("\n");
}

test("renders the rule inline on the label's line (no detached bar)", () => {
  const lines = frameLines(
    <Box flexDirection="column" width={40}>
      <SectionGroup label="THU 11" marginTop={0} />
    </Box>,
  );
  const labelLine = lines.find((l) => l.includes("THU 11"));
  expect(labelLine).toBeDefined();
  // The rule must be on the SAME line as the label.
  expect(labelLine).toContain("─");
  // No line may consist solely of the rule (the old detached "grey bar").
  const detached = lines.filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("renders an inline tag between the label and the rule", () => {
  const lines = frameLines(
    <Box flexDirection="column" width={48}>
      <SectionGroup label="THU 18" tag="next week" marginTop={0} />
    </Box>,
  );
  const labelLine = lines.find((l) => l.includes("THU 18"));
  expect(labelLine).toBeDefined();
  expect(labelLine).toContain("next week");
  expect(labelLine!.indexOf("THU 18")).toBeLessThan(labelLine!.indexOf("next week"));
  expect(labelLine!.indexOf("next week")).toBeLessThan(labelLine!.indexOf("─"));
});

test("rule=false omits the rule but keeps the label", () => {
  const lines = frameLines(
    <Box flexDirection="column" width={40}>
      <SectionGroup label="LIBRARY" rule={false} marginTop={0} />
    </Box>,
  );
  const labelLine = lines.find((l) => l.includes("LIBRARY"));
  expect(labelLine).toBeDefined();
  expect(labelLine).not.toContain("─");
});
