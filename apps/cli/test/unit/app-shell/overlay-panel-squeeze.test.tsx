import { expect, test } from "bun:test";

import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import { OverlayPanel } from "@/app-shell/overlay-panel";
import { Box, Text } from "ink";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Mirrors the browse-shell mount: the overlay sits inside a flex-bounded column
// whose leftover height is smaller than the sheet — the wrapper must clip the
// overflow instead of letting yoga shrink panel rows into each other (weld) or
// letting a nested overflowY bound REPLACE the outer clip and leak rows into
// the footer (ink's output.clip keeps only the innermost region).
function squeezedOverlay({ columns = 100, rows = 22 }: { columns?: number; rows?: number } = {}) {
  const sheet = buildDetailsSheet({
    seed: {
      title: "Squeeze Movie",
      type: "movie",
      year: "2026",
      synopsis: "A synopsis long enough to push the lower sections past the clip bound.",
    },
    detail: null,
    history: null,
    availability: null,
  });
  return captureFrame(
    <Box flexDirection="column" height={rows} width={columns}>
      <Text>header row</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
          <Text>status row</Text>
          <Text>search box</Text>
          <Box flexDirection="column" flexGrow={1} overflowY="hidden">
            <OverlayPanel
              overlay={{
                type: "details",
                title: "Media dossier",
                subtitle: "Squeeze Movie",
                lines: [],
                sheet,
                seasonsExpanded: false,
                loading: false,
                scrollIndex: 0,
              }}
              width={92}
              searchReady={true}
            />
          </Box>
        </Box>
        <Text> Search</Text>
        <Text> [enter] play footer</Text>
      </Box>
    </Box>,
    { columns, rows },
  );
}

test("details sheet clips at the mount bound — no welded rows, no footer bleed", () => {
  const frame = squeezedOverlay();
  const lines = frame.split("\n");

  // Title and subtitle survive as separate rows (the weld that produced
  // "Smoke Movieer" was subtitle text overpainting the title's tail).
  const titleRow = lines.findIndex((line) => line.includes("Media dossier"));
  const subtitleRow = lines.findIndex((line) => line.includes("Squeeze Movie"));
  expect(titleRow).toBeGreaterThan(-1);
  expect(subtitleRow).toBeGreaterThan(titleRow);
  expect(lines[subtitleRow]?.trim()).toBe("Squeeze Movie");

  // Deep sheet sections (Cast) must be clipped, not leaked into the footer zone.
  expect(frame).not.toContain("Cast");

  // Footer rows stay clean — no sheet fragments interleaved between them.
  const searchRow = lines.findIndex((line) => line.trim() === "Search");
  const footerRow = lines.findIndex((line) => line.includes("[enter] play footer"));
  expect(searchRow).toBeGreaterThan(-1);
  expect(footerRow).toBe(searchRow + 1);
});

test("details sheet still renders fully when it fits", () => {
  const frame = squeezedOverlay({ rows: 45 });
  expect(frame).toContain("Cast");
  expect(frame).toContain("[enter] play footer");
});
