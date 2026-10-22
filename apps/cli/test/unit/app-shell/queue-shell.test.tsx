import { expect, test } from "bun:test";

import { QueueShell } from "@/app-shell/queue-shell";
import { buildQueueView } from "@/app-shell/queue-view";
import type { QueueEntry } from "@kunai/storage";
import React, { act } from "react";

import { captureFrame } from "../../harness/render-capture";
import { renderWithPointer } from "../../support/pointer-render";

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
  // Anime rows are episode-only: the stored season is a default slot, not a
  // fact the user chose.
  expect(out).toContain("E08");
  expect(out).not.toContain("S02");
  expect(out).toContain("up next");
  expect(out).not.toContain("playing");
  const detached = out.split("\n").filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("a claimed row renders startup without implying the player began", () => {
  const view = buildQueueView({
    entries: [{ ...entry("1", "Resolving", 1, 2), status: "in-flight" }],
    selectedId: "1",
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  const out = captureFrame(<QueueShell view={view} columns={100} listWidth={92} rowWidth={88} />, {
    columns: 100,
  }).replace(ANSI, "");
  expect(out).toContain("starting");
  expect(out).not.toContain("playing");
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

test("queue pointer regions carry stable row IDs and disappear without an owner", () => {
  const clicked: string[] = [];
  const view = buildQueueView({
    entries: [entry("1", "Frieren", 1, 1), entry("2", "Dune", 1, 2)],
    selectedId: "1",
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  const handle = renderWithPointer(
    <QueueShell
      view={view}
      columns={100}
      listWidth={92}
      rowWidth={88}
      onRowClick={(id) => clicked.push(id)}
    />,
  );
  try {
    handle.click("queue:row:2");
    expect(clicked).toEqual(["2"]);
  } finally {
    handle.unmount();
  }
  const disabled = renderWithPointer(
    <QueueShell view={view} columns={100} listWidth={92} rowWidth={88} />,
  );
  try {
    expect(disabled.dispatcher.size).toBe(0);
  } finally {
    disabled.unmount();
  }
});

test("large queues render and register only their visible selection window", () => {
  const view = buildQueueView({
    entries: Array.from({ length: 1000 }, (_, index) =>
      entry(String(index), `Title ${index}`, 1, 1),
    ),
    selectedId: "500",
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  const clicks: string[] = [];
  const handle = renderWithPointer(
    <QueueShell
      view={view}
      columns={100}
      listWidth={92}
      rowWidth={88}
      maxRows={6}
      onRowClick={(id) => clicks.push(id)}
    />,
  );
  try {
    expect(handle.dispatcher.size).toBe(6);
    expect(handle.lastFrame()).toContain("Title 500");
    expect(handle.lastFrame()).not.toContain("Title 999");
    handle.click("queue:row:500");
    expect(clicks).toEqual(["500"]);
  } finally {
    handle.unmount();
  }
});

test("preselected queue playback requires a prior click and wheel clears that intent", () => {
  const view = buildQueueView({
    entries: [entry("1", "Frieren", 1, 1)],
    selectedId: "1",
    resolvePoster: () => undefined,
    recoverableSessions: 0,
  });
  const clicks: boolean[] = [];
  const handle = renderWithPointer(
    <QueueShell
      view={view}
      columns={100}
      listWidth={92}
      rowWidth={88}
      onRowClick={(_id, activate) => clicks.push(activate)}
      onWheel={() => {}}
    />,
  );
  try {
    handle.click("queue:row:1");
    handle.click("queue:row:1");
    handle.click("queue:row:1");
    handle.wheel("queue:row:1", "up");
    handle.click("queue:row:1");
    expect(clicks).toEqual([false, true, false, false]);
  } finally {
    handle.unmount();
  }
});

test.each(["up", "down"])(
  "keyboard navigation clears queue click intent even when its selected row cannot change (%s)",
  (direction) => {
    const clicks: boolean[] = [];
    const view = buildQueueView({
      entries: [entry("1", "Frieren", 1, 1)],
      selectedId: "1",
      resolvePoster: () => undefined,
      recoverableSessions: 0,
    });
    const handle = renderWithPointer(
      <QueueShell
        view={view}
        columns={100}
        listWidth={92}
        rowWidth={88}
        onRowClick={(_id, activate) => clicks.push(activate)}
      />,
    );
    try {
      handle.click("queue:row:1");
      act(() => handle.stdin.enqueue(String.fromCharCode(27) + (direction === "up" ? "[A" : "[B")));
      handle.click("queue:row:1");
      expect(clicks).toEqual([false, false]);
      handle.click("queue:row:1");
      expect(clicks).toEqual([false, false, true]);
    } finally {
      handle.unmount();
    }
  },
);
