import { expect, test } from "bun:test";

import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { OverlayLayoutProvider } from "@/app-shell/overlay-layout-context";
import type { Container } from "@/container";
import { measureColumns } from "@/domain/text-display";
import type { DownloadJobRecord } from "@kunai/storage";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

type DownloadEvent = { readonly type: string };

function queuedJob(overrides: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  // SAFETY: these shell tests read only the job display/state fields initialized
  // below; storage metadata omitted from the record is never dereferenced.
  return {
    id: "job-1",
    titleId: "title-1",
    titleName: "Frieren",
    status: "queued",
    mediaKind: "anime",
    mode: "series",
    providerId: "videasy",
    season: 1,
    episode: 3,
    createdAt: new Date("2026-06-24T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-06-24T00:00:00.000Z").toISOString(),
    progressPercent: 0,
    outputPath: "/tmp/frieren-s01e03.mp4",
    ...overrides,
  } as DownloadJobRecord;
}

function createContainerFixture() {
  const removed: string[] = [];
  const removalOptions: Array<{ deleteArtifact: boolean }> = [];
  let listener: ((event: DownloadEvent) => void) | null = null;
  let activeJobs: DownloadJobRecord[] = [];
  let completedJobs: DownloadJobRecord[] = [];
  let failedJobs: DownloadJobRecord[] = [];

  // SAFETY: the download-manager input tests invoke only the state, config, and
  // downloadService members defined on this fixture.
  const container = {
    stateManager: { dispatch: () => undefined },
    config: {
      zenMode: false,
    },
    downloadService: {
      listActive: () => activeJobs,
      listCompleted: () => completedJobs,
      listFailed: () => failedJobs,
      onEvent: (nextListener: (event: DownloadEvent) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
      abort: async () => undefined,
      deleteJob: async (jobId: string, options: { deleteArtifact: boolean }) => {
        removalOptions.push(options);
        removed.push(jobId);
        return { status: "deleted", jobId };
      },

      retry: async () => undefined,
      kickQueue: () => undefined,
    },
  } as unknown as Container;

  return {
    container,
    removed,
    removalOptions,
    setActiveJobs(nextJobs: DownloadJobRecord[]) {
      activeJobs = nextJobs;
    },
    setCompletedJobs(nextJobs: DownloadJobRecord[]) {
      completedJobs = nextJobs;
    },
    setFailedJobs(nextJobs: DownloadJobRecord[]) {
      failedJobs = nextJobs;
    },
    emit(event: DownloadEvent) {
      act(() => {
        listener?.(event);
      });
    },
  };
}

test("download manager ignores empty-list arrows and selects the first later job", () => {
  const fixture = createContainerFixture();
  const handle = render(
    <DownloadManagerContent container={fixture.container} onClose={() => undefined} />,
    { columns: 120, rows: 35 },
  );

  try {
    expect(handle.lastFrame()).toContain("No downloads queued");

    handle.stdin.enqueue("\u001b[B");
    handle.stdin.enqueue("\u001b[A");

    fixture.setActiveJobs([queuedJob()]);
    fixture.emit({ type: "enqueued" });

    const frame = handle.lastFrame();
    expect(frame).toContain("Frieren");
    expect(frame).toContain("x to remove from queue");
  } finally {
    handle.unmount();
  }
});

/**
 * Inside a root-owned overlay the provider's `contentColumns` is the width
 * budget — the raw terminal is wider because the frame consumes the difference.
 * Reading the terminal directly is how rows ended up overflowing their frame.
 */
test("download manager obeys overlay content columns, not raw terminal width", () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([queuedJob()]);

  const handle = render(
    <OverlayLayoutProvider
      value={{ contentColumns: 72, contentRows: 24, chromeRows: 6, listMaxVisible: 12 }}
    >
      <DownloadManagerContent container={fixture.container} onClose={() => undefined} />
    </OverlayLayoutProvider>,
    { columns: 140, rows: 40 },
  );

  try {
    fixture.emit({ type: "enqueued" });
    const frame = stripAnsi(handle.lastFrame() ?? "");
    expect(frame).toContain("Frieren");
    for (const line of frame.split("\n")) {
      expect(measureColumns(line)).toBeLessThanOrEqual(72);
    }
  } finally {
    handle.unmount();
  }
});

test("a wide overlay renders the selected-job rail", () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([queuedJob({ posterUrl: "https://img.example/frieren.jpg" })]);

  const handle = render(
    <OverlayLayoutProvider
      value={{ contentColumns: 140, contentRows: 36, chromeRows: 6, listMaxVisible: 20 }}
    >
      <DownloadManagerContent container={fixture.container} onClose={() => undefined} />
    </OverlayLayoutProvider>,
    { columns: 140, rows: 40 },
  );

  try {
    fixture.emit({ type: "enqueued" });
    const frame = stripAnsi(handle.lastFrame() ?? "");
    // "Status" is a rail-only fact label; the list row shows a bare state chip.
    expect(frame).toContain("Status");
    // The rail restates the selected job's canonical position.
    expect(frame).toContain("E03");
    for (const line of frame.split("\n")) {
      expect(measureColumns(line)).toBeLessThanOrEqual(140);
    }
  } finally {
    handle.unmount();
  }
});

test("a legacy synthetic movie job never renders S01E01 in the download list", () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([
    queuedJob({
      id: "movie-1",
      titleName: "Dune: Part Two",
      mediaKind: "movie",
      season: 1,
      episode: 1,
    }),
  ]);

  const handle = render(
    <DownloadManagerContent container={fixture.container} onClose={() => undefined} />,
    { columns: 120, rows: 35 },
  );

  try {
    fixture.emit({ type: "enqueued" });
    const frame = stripAnsi(handle.lastFrame() ?? "");
    expect(frame).toContain("Dune: Part Two");
    expect(frame).not.toContain("S01E01");
    expect(frame).toContain("Movie");
  } finally {
    handle.unmount();
  }
});

test("an anime film job never renders E01 in the download list", () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([
    queuedJob({
      id: "anime-film-1",
      titleName: "Infinity Castle",
      mediaKind: "anime",
      contentType: "movie",
      season: 1,
      episode: 1,
    }),
  ]);

  const handle = render(
    <DownloadManagerContent container={fixture.container} onClose={() => undefined} />,
    { columns: 120, rows: 35 },
  );

  try {
    fixture.emit({ type: "enqueued" });
    const frame = stripAnsi(handle.lastFrame() ?? "");
    expect(frame).toContain("Infinity Castle");
    expect(frame).toContain("Anime");
    expect(frame).not.toContain("E01");
  } finally {
    handle.unmount();
  }
});

/**
 * Raw cursor movement must stay immediate. Only the settled selection may drive
 * poster work, otherwise holding the down arrow spawns a renderer subprocess
 * per row.
 */
test("burst navigation moves the selection immediately", async () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([
    queuedJob({ id: "a", titleName: "Alpha", posterUrl: "https://img.example/a.jpg" }),
    queuedJob({ id: "b", titleName: "Bravo", posterUrl: "https://img.example/b.jpg" }),
    queuedJob({ id: "c", titleName: "Charlie", posterUrl: "https://img.example/c.jpg" }),
  ]);

  const handle = render(
    <OverlayLayoutProvider
      value={{ contentColumns: 140, contentRows: 36, chromeRows: 6, listMaxVisible: 20 }}
    >
      <DownloadManagerContent container={fixture.container} onClose={() => undefined} />
    </OverlayLayoutProvider>,
    { columns: 140, rows: 40 },
  );

  try {
    fixture.emit({ type: "enqueued" });
    expect(stripAnsi(handle.lastFrame() ?? "")).toContain("Alpha");

    await act(async () => {
      handle.stdin.enqueue("\u001b[B");
      handle.stdin.enqueue("\u001b[B");
    });

    const frame = stripAnsi(handle.lastFrame() ?? "");
    expect(frame).toContain("Charlie");
    for (const line of frame.split("\n")) {
      expect(measureColumns(line)).toBeLessThanOrEqual(140);
    }
  } finally {
    handle.unmount();
  }
});

/**
 * A title that exactly fills its column used to butt straight against the state
 * chip ("…○ queued"), which reads as one corrupted word at 72 columns.
 */
test("a truncated title keeps a gutter before the state column", () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([
    queuedJob({
      titleName: "Frieren: Beyond Journey's End and Then Some More Title Than Fits",
      mediaKind: "anime",
      season: undefined,
      episode: 29,
    }),
  ]);

  const handle = render(
    <OverlayLayoutProvider
      value={{ contentColumns: 72, contentRows: 24, chromeRows: 6, listMaxVisible: 12 }}
    >
      <DownloadManagerContent container={fixture.container} onClose={() => undefined} />
    </OverlayLayoutProvider>,
    { columns: 72, rows: 30 },
  );

  try {
    fixture.emit({ type: "enqueued" });
    const frame = stripAnsi(handle.lastFrame() ?? "");
    const row = frame.split("\n").find((line) => line.includes("Frieren"));
    expect(row).toBeDefined();
    expect(row).toContain("…");
    expect(row).not.toMatch(/…\S/);
  } finally {
    handle.unmount();
  }
});

test("delete confirmation cannot transfer to a replacement row after refresh", async () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([queuedJob({ id: "old", titleName: "Old selection" })]);
  const handle = render(
    <DownloadManagerContent container={fixture.container} onClose={() => undefined} />,
    { columns: 120, rows: 35 },
  );
  try {
    await act(async () => {
      handle.stdin.enqueue("x");
    });
    expect(stripAnsi(handle.lastFrame() ?? "")).toContain("Remove record Old selection?");
    fixture.setActiveJobs([queuedJob({ id: "replacement", titleName: "Replacement selection" })]);
    fixture.emit({ type: "enqueued" });
    await act(async () => {
      handle.stdin.enqueue("x");
    });
    expect(fixture.removed).toEqual([]);
    await act(async () => {
      handle.stdin.enqueue("x");
    });
    expect(fixture.removed).toEqual([]);
    await act(async () => {
      handle.stdin.enqueue("y");
    });
    expect(fixture.removed).toEqual(["replacement"]);
  } finally {
    handle.unmount();
  }
});

test.each([
  "completed",
  "completed-with-notes",
  "repairable",
] satisfies DownloadJobRecord["status"][])(
  "Downloads advertises the exact record-only confirmation key for %s",
  async (status) => {
    const fixture = createContainerFixture();
    const job = queuedJob({ status });
    if (status === "repairable") fixture.setFailedJobs([job]);
    else fixture.setCompletedJobs([job]);
    const handle = render(
      <DownloadManagerContent container={fixture.container} onClose={() => undefined} />,
      { columns: 120, rows: 35 },
    );
    try {
      await act(async () => {
        handle.stdin.enqueue("X");
      });
      const frame = stripAnsi(handle.lastFrame() ?? "");
      expect(frame).toContain("Remove record");
      expect(frame).not.toContain("Press X again");
      expect(frame).not.toContain("Press x or X again");
      await act(async () => {
        handle.stdin.enqueue("x");
      });
      expect(fixture.removed).toEqual([]);
      expect(stripAnsi(handle.lastFrame() ?? "")).toContain("Remove record");
      await act(async () => {
        handle.stdin.enqueue("y");
      });
      expect(fixture.removalOptions).toEqual([{ deleteArtifact: false }]);
    } finally {
      handle.unmount();
    }
  },
);

test("Esc backs out of an armed delete without closing Downloads, and the prompt shows once", async () => {
  const fixture = createContainerFixture();
  fixture.setActiveJobs([queuedJob()]);
  let closed = 0;
  const handle = render(
    <DownloadManagerContent
      container={fixture.container}
      onClose={() => {
        closed += 1;
      }}
    />,
    { columns: 120, rows: 35 },
  );
  try {
    fixture.emit({ type: "enqueued" });
    await act(async () => {
      handle.stdin.enqueue("x");
    });
    const armed = stripAnsi(handle.lastFrame() ?? "");
    expect(armed).toContain("Remove record");

    await pressEscape(handle);
    expect(closed).toBe(0);
    expect(stripAnsi(handle.lastFrame() ?? "")).not.toContain("Remove record");
    expect(fixture.removed).toEqual([]);

    await pressEscape(handle);
    expect(closed).toBe(1);
  } finally {
    handle.unmount();
  }
});

async function pressEscape(handle: { stdin: { enqueue: (data: string) => void } }): Promise<void> {
  await act(async () => {
    handle.stdin.enqueue("\x1b");
    // Ink defers a lone ESC briefly to tell it from an escape sequence — the
    // same convention as browse-suggestions' and library-input-ownership's.
    // sleep-allow: Ink's lone-ESC disambiguation window; not a component clock
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}
