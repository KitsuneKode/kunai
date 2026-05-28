import { AppHeader } from "@/app-shell/primitives/AppHeader";
import React from "react";

import { captureFrame } from "./render-capture";

// Reproduce the reported "header bleed": a long crumb colliding with the right
// status group on a narrow terminal. Print frames at a few widths inline.
for (const cols of [64, 80, 100]) {
  const node = (
    <AppHeader
      destination="watch"
      context="anime · allanime · Frieren: Beyond Journey's End · S01E04 · eng sub"
      status="Playing · eng sub"
      size="80×30"
      width={cols - 2}
    />
  );
  console.log(`--- ${cols} cols ---`);
  console.log(captureFrame(node, { columns: cols }));
  console.log("");
}
process.exit(0);
