import { expect, test } from "bun:test";

import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import { detailsSheetContextFor } from "@/app/search/details-sheet-context";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const progress = (updatedAt: string, episode: number, positionSeconds: number) => ({
  titleId: "tmdb:1",
  season: 1,
  episode,
  positionSeconds,
  durationSeconds: 1200,
  completed: false,
  providerId: "vidking",
  updatedAt,
});

// Neon features review #4: the sheet always got `history: null,
// availability: null`, so "Your progress" and "Where" never rendered.
test("the details sheet shows your latest progress and where the title is available", () => {
  const context = detailsSheetContextFor(
    // SAFETY: the builder reads only listByTitle and listCompleted.
    {
      historyRepository: {
        listByTitle: () => [
          progress("2026-01-01T00:00:00.000Z", 3, 1200),
          progress("2026-01-02T00:00:00.000Z", 4, 504),
        ],
      },
      downloadService: { listCompleted: () => [{ titleId: "tmdb:1" }] },
    } as never,
    "tmdb:1",
  );

  expect(context.history).toMatchObject({ season: 1, episode: 4, positionSeconds: 504 });
  expect(context.availability).toEqual({ providers: ["vidking"], offline: true, subs: [] });

  const frame = captureFrame(
    <DetailsSheet
      model={buildDetailsSheet({
        seed: { title: "Show", type: "series" },
        detail: null,
        ...context,
      })}
      seasonsExpanded={false}
      width={90}
    />,
    { columns: 100 },
  );
  expect(frame).toContain("Your progress · S01E04 · 42%");
  expect(frame).toContain("vidking");
  expect(frame).toContain("offline");
});

test("a title you have never touched has no local context", () => {
  const context = detailsSheetContextFor(
    // SAFETY: the builder reads only listByTitle and listCompleted.
    {
      historyRepository: { listByTitle: () => [] },
      downloadService: { listCompleted: () => [] },
    } as never,
    "tmdb:2",
  );
  expect(context).toEqual({ history: null, availability: null });
});
