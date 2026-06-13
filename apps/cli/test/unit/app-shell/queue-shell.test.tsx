import { expect, test } from "bun:test";

import { QueueShell } from "@/app-shell/queue-shell";
import { buildQueueView } from "@/app-shell/queue-view";
import type { QueueEntry } from "@kunai/storage";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function entry(id: string, title: string, season: number, episode: number): QueueEntry {
  return {
    id,
    title,
    titleId: title,
    mediaKind: "anime",
    season,
    episode,
    priority: 0,
    source: "watchlist",
    addedAt: "2026-06-14T00:00:00Z",
    sessionId: "s1",
    status: "pending",
  } as QueueEntry;
}

function frame(cols: number): string {
  const view = buildQueueView({
    entries: [entry("1", "The Eminence in Shadow", 2, 8), entry("2", "Frieren", 1, 12)],
    selectedId: "1",
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  return captureFrame(
    <QueueShell
      view={view}
      columns={cols}
      listWidth={Math.min(cols - 8, 96)}
      rowWidth={Math.min(cols - 12, 92)}
    />,
    { columns: cols },
  ).replace(ANSI, "");
}

test.each([72, 100, 140])("renders queue rows cleanly at %i cols", (cols) => {
  const out = frame(cols);
  expect(out).toContain("UP NEXT");
  expect(out).toContain("The Eminence in Shadow");
  expect(out).toContain("S02·E08");
  const detached = out.split("\n").filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("empty state shows the hint", () => {
  const view = buildQueueView({
    entries: [],
    selectedId: null,
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  const out = captureFrame(<QueueShell view={view} columns={100} listWidth={92} rowWidth={88} />, {
    columns: 100,
  }).replace(ANSI, "");
  expect(out).toContain("Queue is empty");
});
