import { expect, test } from "bun:test";

import { buildBrowseDetailsPanel } from "@/app-shell/details-panel";
import type { BrowseShellOption } from "@/app-shell/types";

function option(): BrowseShellOption<{ id: string }> {
  return {
    value: { id: "1" },
    label: "Breaking Bad",
    previewTitle: "Breaking Bad",
    previewMeta: ["Series", "2008", "8.9/10 TMDB"],
    previewRating: "8.9/10 TMDB",
    previewBody: "A high-school chemistry teacher turned methamphetamine producer.",
    previewImageUrl: "https://img.example/bb.jpg",
    previewFacts: [{ label: "Metadata source", detail: "TMDB", tone: "success" }],
  } as BrowseShellOption<{ id: string }>;
}

test("detail panel is compact — no duplicated Type/Year facts, no Open/Selection scaffolding", () => {
  const panel = buildBrowseDetailsPanel(option());
  const labels = panel.lines.map((line) => line.label);

  expect(labels).toContain("Title");
  expect(labels).toContain("At a glance");
  // type/year/rating live in the single "At a glance" line, not as separate facts
  expect(labels).not.toContain("Type");
  expect(labels).not.toContain("Year");
  expect(labels).not.toContain("Open");
  expect(labels).not.toContain("─── Selection");
  // tight: well under the old ~21-line sparse model
  expect(panel.lines.length).toBeLessThanOrEqual(8);
  expect(panel.imageUrl).toBe("https://img.example/bb.jpg");
});
