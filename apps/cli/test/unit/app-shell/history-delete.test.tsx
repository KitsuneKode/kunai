import { describe, expect, test } from "bun:test";

import { HistoryShell } from "@/app-shell/history-shell";
import type { HistoryView, HistoryViewRow } from "@/app-shell/history-view";
import { KEYBINDINGS, bindingKeys, footerKeyFromBinding } from "@/app-shell/keybindings";
import { handleHistoryOverlayInput } from "@/app-shell/use-history-overlay-input";
import type { HistoryProgress } from "@kunai/storage";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

function history(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "tmdb:1:1:2",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Demo",
    season: 1,
    episode: 2,
    positionSeconds: 120,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-06-22T00:00:00.000Z",
    createdAt: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}

function baseCtx(overrides: Partial<Parameters<typeof handleHistoryOverlayInput>[2]> = {}) {
  return {
    container: {
      historyRepository: {
        deleteProgressByKey: () => {},
        deleteTitle: () => {},
      },
    } as never,
    historyView: { flatRows: [{ titleId: "tmdb:1", dualSourceAvailable: false }] },
    historySelections: [{ titleId: "tmdb:1", entry: history() }],
    historyPickerContext: {},
    selectedIndex: 0,
    sourceChoiceTitleId: null,
    sourcePreference: "auto" as const,
    setSourceChoiceTitleId: () => {},
    setHistoryTypeFilter: () => {},
    setHistoryTab: () => {},
    setSelectedIndex: () => {},
    setOverlayStatus: () => {},
    onRedraw: () => {},
    pendingDelete: null,
    setPendingDelete: () => {},
    onHistoryMutated: () => {},
    onConfirmSelection: () => {},
    ...overrides,
  };
}

describe("history delete UX", () => {
  test("x arms episode delete confirm using progress key", () => {
    const pending: Array<unknown> = [];
    handleHistoryOverlayInput(
      "x",
      {},
      {
        ...baseCtx(),
        setPendingDelete: (next) => pending.push(next),
      },
    );
    expect(pending[0]).toEqual({
      kind: "episode",
      key: "tmdb:1:1:2",
      label: expect.any(String),
    });
  });

  test("Shift+X arms title delete confirm", () => {
    const pending: Array<unknown> = [];
    handleHistoryOverlayInput(
      "X",
      { shift: true },
      {
        ...baseCtx(),
        setPendingDelete: (next) => pending.push(next),
      },
    );
    expect(pending[0]).toEqual({
      kind: "title",
      titleId: "tmdb:1",
      label: "Demo",
    });
  });

  test("y confirms episode delete via deleteProgressByKey only", () => {
    const calls: string[] = [];
    handleHistoryOverlayInput(
      "y",
      {},
      {
        ...baseCtx({
          pendingDelete: { kind: "episode", key: "tmdb:1:1:2", label: "Demo · S01E02" },
          container: {
            historyRepository: {
              deleteProgressByKey: (key: string) => calls.push(`episode:${key}`),
              deleteTitle: (titleId: string) => calls.push(`title:${titleId}`),
            },
          } as never,
          setPendingDelete: (next) => {
            if (next === null) calls.push("cleared");
          },
          onHistoryMutated: () => calls.push("mutated"),
        }),
      },
    );
    expect(calls).toEqual(["episode:tmdb:1:1:2", "cleared", "mutated"]);
  });

  test("Esc cancels without mutating", () => {
    const calls: string[] = [];
    handleHistoryOverlayInput(
      "",
      { escape: true },
      {
        ...baseCtx({
          pendingDelete: { kind: "episode", key: "tmdb:1:1:2", label: "Demo · S01E02" },
          container: {
            historyRepository: {
              deleteProgressByKey: () => calls.push("episode"),
              deleteTitle: () => calls.push("title"),
            },
          } as never,
          setPendingDelete: (next) => {
            if (next === null) calls.push("cleared");
          },
          onHistoryMutated: () => calls.push("mutated"),
        }),
      },
    );
    expect(calls).toEqual(["cleared"]);
  });

  test("history delete keybindings register episode and title chords", () => {
    const episode = KEYBINDINGS.find((binding) => binding.id === "history-delete-episode");
    const title = KEYBINDINGS.find((binding) => binding.id === "history-delete-title");
    expect(episode).toMatchObject({ scope: "history", chord: { input: "x" } });
    expect(title).toMatchObject({
      scope: "history",
      display: "⇧X",
      chord: { input: "X", shift: true },
    });
    expect(bindingKeys(title!)).toBe("⇧X");
    expect(footerKeyFromBinding(title!)).toBe("⇧X");
    expect(footerKeyFromBinding(episode!)).toBe("x");
  });

  test("HistoryShell renders confirm banner for pending episode delete", () => {
    const row: HistoryViewRow = {
      titleId: "tmdb:1",
      title: "Demo",
      episodeCode: "S01E02",
      statusLabel: "10%",
      statusColor: "#d98",
      statusDim: true,
      detail: "",
      recencyLabel: "1w ago",
      progress: { percentage: 10, completed: false },
      resumeAction: "resume where you left off",
      dualSourceAvailable: false,
    };
    const view: HistoryView = {
      state: "success",
      tab: "all",
      tabLabels: ["Continue", "Completed", "New episodes", "All"],
      tabIndex: 3,
      typeFilter: "all",
      typeFilterLabels: ["All", "Anime", "Series", "Movie", "Tracked"],
      typeFilterIndex: 0,
      flatRows: [row],
      filterQuery: "",
      showScrollUp: false,
      showScrollDown: false,
      rail: null,
      items: [{ kind: "row", row, flatIndex: 0, selected: true }],
    };
    const frame = captureFrame(
      <HistoryShell
        view={view}
        columns={120}
        listWidth={80}
        rowWidth={76}
        pendingDelete={{ kind: "episode", key: "tmdb:1:1:2", label: "Demo · S01E02" }}
      />,
      { columns: 120 },
    );
    expect(frame).toContain("Delete episode progress for Demo · S01E02?");
    expect(frame).toContain("y confirm");
    expect(frame).toContain("Esc cancel");
  });
});
