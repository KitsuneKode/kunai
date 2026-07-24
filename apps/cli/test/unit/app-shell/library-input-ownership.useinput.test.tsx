import { describe, expect, test } from "bun:test";

import { LibraryShell } from "@/app-shell/library-shell";
import type { Container } from "@/container";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

type FixtureOptions = {
  readonly updates?: unknown[];
  readonly initialView?: "library" | "queue";
};

function offlineEntry(overrides: Partial<OfflineLibraryEntry["job"]> = {}): OfflineLibraryEntry {
  return {
    job: {
      id: "job-1",
      titleId: "title-1",
      titleName: "Dune",
      mediaKind: "series",
      season: 1,
      episode: 1,
      outputPath: "/tmp/dune-s01e01.mp4",
      tempPath: "/tmp/dune-s01e01.part",
      streamUrl: "https://example/dune",
      headers: {},
      status: "completed",
      progressPercent: 100,
      fileSize: 1024 * 1024,
      retryCount: 0,
      attempt: 1,
      maxAttempts: 3,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-20T00:00:00.000Z",
      providerId: "vidking",
      ...overrides,
    },
    status: "ready",
  };
}

function fixture(options: FixtureOptions = {}): Container {
  const updates = options.updates ?? [];
  return {
    config: {
      zenMode: false,
      downloadsEnabled: true,
      protectedDownloadJobIds: [] as string[],
      update: async (patch: unknown) => {
        updates.push(patch);
      },
      save: async () => undefined,
    },
    downloadService: {
      listActive: () => [],
      listCompleted: () => [],
      listFailed: () => [],
      onEvent: () => () => undefined,
      deleteJob: () => undefined,
      abort: async () => undefined,
      retry: async () => undefined,
      processQueue: async () => undefined,
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
    },
    offlineLibraryService: {
      listCompletedEntries: async () => [offlineEntry()],
    },
    historyRepository: {
      listLatestByTitle: () => [],
      listByTitle: () => [],
    },
    stateManager: {
      dispatch: () => undefined,
    },
    connectivity: {
      isOnline: () => true,
      subscribe: () => () => undefined,
    },
  } as unknown as Container;
}

async function waitForFrame(
  handle: { lastFrame: () => string | undefined },
  needle: string,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (handle.lastFrame()?.includes(needle)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`frame never contained ${JSON.stringify(needle)}\n${handle.lastFrame() ?? ""}`);
}

async function pressEscape(handle: { stdin: { enqueue: (data: string) => void } }): Promise<void> {
  await act(async () => {
    handle.stdin.enqueue("\x1b");
    // Ink defers a lone ESC briefly to disambiguate escape sequences.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

describe("library input ownership", () => {
  test("printable d filters once and does not toggle config", async () => {
    const updates: unknown[] = [];
    const handle = render(<LibraryShell container={fixture({ updates })} onClose={() => {}} />, {
      columns: 100,
      rows: 40,
    });
    try {
      await waitForFrame(handle, "Dune");
      handle.stdin.enqueue("d");
      // The label and the typed value sit in different styles, so the raw frame
      // has escape bytes between them whenever colour is on.
      expect(stripAnsi(handle.lastFrame())).toContain("Filter: d");
      expect(updates).toEqual([]);
    } finally {
      handle.unmount();
    }
  });

  test("Enter opens detail and Esc returns once without closing the shell", async () => {
    let closeCount = 0;
    const handle = render(
      <LibraryShell
        container={fixture()}
        onClose={() => {
          closeCount += 1;
        }}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune");
      handle.stdin.enqueue("\r");
      await waitForFrame(handle, "Continue this title online");
      await pressEscape(handle);
      expect(handle.lastFrame()).toContain("Dune");
      expect(handle.lastFrame()).not.toContain("Continue this title online");
      expect(closeCount).toBe(0);
    } finally {
      handle.unmount();
    }
  });

  test("Tab navigates to Downloads exactly once", async () => {
    const handle = render(<LibraryShell container={fixture()} onClose={() => {}} />, {
      columns: 100,
      rows: 40,
    });
    try {
      await waitForFrame(handle, "Dune");
      handle.stdin.enqueue("\t");
      await waitForFrame(handle, "No downloads queued");
      expect(handle.lastFrame()).toContain("Downloads");
      // Second Tab returns to Library once — not a stuck double-toggle.
      handle.stdin.enqueue("\t");
      await waitForFrame(handle, "Dune");
      expect(handle.lastFrame()).not.toContain("No downloads queued");
    } finally {
      handle.unmount();
    }
  });

  test("l from Downloads returns to Library once", async () => {
    const handle = render(
      <LibraryShell container={fixture()} onClose={() => {}} initialView="queue" />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "No downloads queued");
      handle.stdin.enqueue("l");
      await waitForFrame(handle, "Dune");
      expect(handle.lastFrame()).not.toContain("No downloads queued");
    } finally {
      handle.unmount();
    }
  });

  test("Esc closes the shell exactly once from the title list", async () => {
    let closeCount = 0;
    const handle = render(
      <LibraryShell
        container={fixture()}
        onClose={() => {
          closeCount += 1;
        }}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune");
      await pressEscape(handle);
      expect(closeCount).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("Esc closes the shell exactly once from Downloads", async () => {
    let closeCount = 0;
    const handle = render(
      <LibraryShell
        container={fixture()}
        onClose={() => {
          closeCount += 1;
        }}
        initialView="queue"
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "No downloads queued");
      await pressEscape(handle);
      expect(closeCount).toBe(1);
    } finally {
      handle.unmount();
    }
  });
});
