import { describe, expect, test } from "bun:test";

import { LibraryShell } from "@/app-shell/library-shell";
import type { Container } from "@/container";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

type FixtureOptions = {
  readonly updates?: unknown[];
  readonly deletes?: string[];
  readonly metadataRepairs?: string[][];
  readonly protectedDownloadJobIds?: readonly string[];
  readonly initialView?: "library" | "queue";
  readonly entries?: readonly OfflineLibraryEntry[];
  readonly entryResponses?: readonly (readonly OfflineLibraryEntry[])[];
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
  let entryResponseIndex = 0;
  return {
    config: {
      zenMode: false,
      downloadsEnabled: true,
      protectedDownloadJobIds: [...(options.protectedDownloadJobIds ?? [])],
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
      deleteJob: (jobId: string) => {
        options.deletes?.push(jobId);
      },
      abort: async () => undefined,
      retry: async () => undefined,
      processQueue: async () => undefined,
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
      repairArtifactMetadata: async (jobIds: readonly string[]) => {
        options.metadataRepairs?.push([...jobIds]);
        return jobIds.length;
      },
    },
    offlineLibraryService: {
      listCompletedEntries: async () => {
        const responses = options.entryResponses;
        if (!responses || responses.length === 0) return options.entries ?? [offlineEntry()];
        const response = responses[Math.min(entryResponseIndex, responses.length - 1)] ?? [];
        entryResponseIndex += 1;
        return response;
      },
    },
    historyRepository: {
      listLatestByTitle: () => [],
      listByTitle: () => [],
    },
    offlineTitlePolicies: {
      get: () => null,
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
      expect(stripAnsi(handle.lastFrame())).toContain("Download more episodes");
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

  /**
   * The library shelf used to read season identity back out of a formatted
   * label with a regex, so a movie stored with a synthetic season 1/episode 1
   * rendered as a season the user does not have.
   */
  test("a legacy synthetic movie title never renders S01E01 or a season code", async () => {
    const handle = render(
      <LibraryShell
        container={fixture({
          entries: [
            offlineEntry({
              titleId: "dune",
              titleName: "Dune: Part Two",
              mediaKind: "movie",
              season: 1,
              episode: 1,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune: Part Two");
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).not.toContain("S01E01");
      expect(frame).not.toContain("S01");
    } finally {
      handle.unmount();
    }
  });

  test("movie detail renders an inherited legacy null row without E01", async () => {
    const handle = render(
      <LibraryShell
        container={fixture({
          entries: [
            offlineEntry({
              id: "legacy",
              titleId: "infinity-castle",
              titleName: "Infinity Castle",
              mediaKind: "anime",
              contentType: undefined,
              season: 1,
              episode: 1,
            }),
            offlineEntry({
              id: "movie",
              titleId: "infinity-castle",
              titleName: "Infinity Castle",
              mediaKind: "anime",
              contentType: "movie",
              season: undefined,
              episode: undefined,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 200, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Infinity Castle");
      handle.stdin.enqueue("\r");
      await waitForFrame(handle, "Continue this title online");
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).not.toContain("E01");
      expect(frame).not.toContain("S01");
      expect(frame).toContain("2 of 2 movies");
      expect(frame).not.toContain("2 of 2 episodes");
      expect(frame).toContain("Download this movie");
      expect(frame).toContain("Open title-level down");
      expect(frame).not.toContain("Download more episodes");
      expect(frame).not.toContain("Open the download epi");
    } finally {
      handle.unmount();
    }
  });

  test("ready-item counts use the canonical item noun rather than fixed ep copy", async () => {
    const handle = render(
      <LibraryShell
        container={fixture({
          entries: [
            offlineEntry({
              titleId: "dune",
              titleName: "Dune: Part Two",
              mediaKind: "movie",
              season: 1,
              episode: 1,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune: Part Two");
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).toContain("1 movie");
      expect(frame).not.toContain("1 ep");
    } finally {
      handle.unmount();
    }
  });

  test("movie partition preview size excludes same-identity series and unresolved jobs", async () => {
    const handle = render(
      <LibraryShell
        container={fixture({
          entries: [
            offlineEntry({
              id: "movie",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "movie",
              fileSize: 1_048_576,
            }),
            offlineEntry({
              id: "series",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "series",
              episode: 2,
              fileSize: 8 * 1_048_576,
            }),
            offlineEntry({
              id: "legacy",
              titleId: "shared",
              mediaKind: "anime",
              contentType: undefined,
              episode: 3,
              fileSize: 16 * 1_048_576,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 140, rows: 40 },
    );
    try {
      await waitForFrame(handle, "size");
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).toContain("1.0 MB");
      expect(frame).not.toContain("25.0 MB");
    } finally {
      handle.unmount();
    }
  });

  test("movie partition does not inherit same-identity series cleanup protection", async () => {
    const handle = render(
      <LibraryShell
        container={fixture({
          protectedDownloadJobIds: ["series"],
          entries: [
            offlineEntry({
              id: "movie",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "movie",
            }),
            offlineEntry({
              id: "series",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "series",
              episode: 2,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Anime");
      const movieRow = stripAnsi(handle.lastFrame())
        .split("\n")
        .find((line) => line.includes("Anime"));
      expect(movieRow).not.toContain("⚲");
    } finally {
      handle.unmount();
    }
  });

  test("deleting a movie partition leaves same-identity series and unresolved jobs intact", async () => {
    const deletes: string[] = [];
    const handle = render(
      <LibraryShell
        container={fixture({
          deletes,
          entries: [
            offlineEntry({
              id: "movie",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "movie",
            }),
            offlineEntry({
              id: "series",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "series",
              episode: 2,
            }),
            offlineEntry({
              id: "legacy",
              titleId: "shared",
              mediaKind: "anime",
              contentType: undefined,
              episode: 3,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune");
      handle.stdin.enqueue("x");
      await waitForFrame(handle, "Press x again");
      handle.stdin.enqueue("x");
      expect(deletes).toEqual(["movie"]);
    } finally {
      handle.unmount();
    }
  });

  test("protecting a movie partition leaves same-identity series and unresolved jobs unchanged", async () => {
    const updates: unknown[] = [];
    const handle = render(
      <LibraryShell
        container={fixture({
          updates,
          entries: [
            offlineEntry({
              id: "movie",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "movie",
            }),
            offlineEntry({
              id: "series",
              titleId: "shared",
              mediaKind: "anime",
              contentType: "series",
              episode: 2,
            }),
            offlineEntry({
              id: "legacy",
              titleId: "shared",
              mediaKind: "anime",
              contentType: undefined,
              episode: 3,
            }),
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune");
      handle.stdin.enqueue("p");
      await act(async () => {
        await Promise.resolve();
      });
      expect(updates).toEqual([{ protectedDownloadJobIds: ["movie"] }]);
    } finally {
      handle.unmount();
    }
  });

  test("detail repair and refresh stay inside the selected movie partition", async () => {
    const metadataRepairs: string[][] = [];
    const movie = offlineEntry({
      id: "movie",
      titleId: "shared",
      mediaKind: "anime",
      contentType: "movie",
    });
    const series = offlineEntry({
      id: "series",
      titleId: "shared",
      mediaKind: "anime",
      contentType: "series",
      episode: 2,
    });
    const legacy = offlineEntry({
      id: "legacy",
      titleId: "shared",
      mediaKind: "anime",
      contentType: undefined,
      episode: 3,
    });
    const handle = render(
      <LibraryShell
        container={fixture({
          metadataRepairs,
          entryResponses: [
            [movie, series, legacy],
            [series, legacy],
          ],
        })}
        onClose={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      await waitForFrame(handle, "Dune");
      handle.stdin.enqueue("\r");
      await waitForFrame(handle, "Continue this title online");
      for (let index = 0; index < 4; index += 1) {
        handle.stdin.enqueue("\u001b[B");
      }
      handle.stdin.enqueue("\r");
      await waitForFrame(handle, "1 title · 2 local items");
      expect(metadataRepairs).toEqual([["movie"]]);
      expect(stripAnsi(handle.lastFrame())).not.toContain("Continue this title online");
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
