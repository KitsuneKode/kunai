import { describe, expect, test } from "bun:test";

import { HistoryShell } from "@/app-shell/history-shell";
import type { HistoryView, HistoryViewRow } from "@/app-shell/history-view";
import { KEYBINDINGS, bindingKeys, footerKeyFromBinding } from "@/app-shell/keybindings";
import { ConfirmStrip } from "@/app-shell/primitives/ConfirmStrip";
import { handleHistoryOverlayInput } from "@/app-shell/use-history-overlay-input";
import type { HistoryProgress } from "@kunai/storage";
import React from "react";

import { captureFrame } from "../../harness/render-capture";
import { armedConfirmStripHarness, createConfirmStripHarness } from "./history-confirm-test-utils";

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

// SAFETY: this test double is intentionally narrowed to the exact contract exercised here.
// oxlint-disable-next-line anti-slop(require-safety-comment-for-type-assertion) -- justified partial test fixture
const visibleIds = ["title:tmdb:1", "episode:tmdb:1:1:2"] as const;

function baseCtx(
  overrides: Partial<Parameters<typeof handleHistoryOverlayInput>[2]> = {},
): Parameters<typeof handleHistoryOverlayInput>[2] {
  const confirm = createConfirmStripHarness();
  return {
    container: {
      historyRepository: {
        deleteProgressByKey: () => {},
        deleteTitle: () => {},
      },
      // SAFETY: this test double is intentionally narrowed to the exact contract exercised here.
      // SAFETY: deliberately partial test fixture narrowed to the contract exercised here.
      // oxlint-disable-next-line anti-slop(require-safety-comment-for-type-assertion) -- justified partial test fixture
    } as never,
    historyView: { flatRows: [{ titleId: "tmdb:1", dualSourceAvailable: false }] },
    historySelections: [{ titleId: "tmdb:1", entry: history() }],
    historyPickerContext: {},
    selectedIndex: 0,
    sourceChoiceTitleId: null,
    // SAFETY: this test double is intentionally narrowed to the exact contract exercised here.
    // oxlint-disable-next-line anti-slop(require-safety-comment-for-type-assertion) -- justified partial test fixture
    sourcePreference: "auto" as const,
    setSourceChoiceTitleId: () => {},
    setHistoryTypeFilter: () => {},
    setHistoryTab: () => {},
    setSelectedIndex: () => {},
    setOverlayStatus: () => {},
    onRedraw: () => {},
    confirmState: confirm.state,
    transitionConfirm: confirm.transition,
    confirmationVisibleIds: visibleIds,
    onHistoryMutated: () => {},
    onConfirmSelection: () => {},
    filterQuery: "",
    filterFocused: false,
    setFilterFocused: () => {},
    ...overrides,
  };
}

describe("history delete UX", () => {
  test("x arms episode delete with the stable progress key", () => {
    const confirm = createConfirmStripHarness();
    handleHistoryOverlayInput(
      "x",
      {},
      baseCtx({ confirmState: confirm.state, transitionConfirm: confirm.transition }),
    );
    expect(confirm.state).toMatchObject({
      kind: "armed",
      targetId: "episode:tmdb:1:1:2",
      verb: "delete",
    });
  });

  test("Shift+X arms title delete with the stable title id", () => {
    const confirm = createConfirmStripHarness();
    handleHistoryOverlayInput(
      "X",
      { shift: true },
      baseCtx({ confirmState: confirm.state, transitionConfirm: confirm.transition }),
    );
    expect(confirm.state).toMatchObject({ kind: "armed", targetId: "title:tmdb:1" });
  });

  test("y confirms episode delete via deleteProgressByKey only", () => {
    const calls: string[] = [];
    const confirm = armedConfirmStripHarness();
    handleHistoryOverlayInput(
      "y",
      {},
      baseCtx({
        confirmState: confirm.state,
        transitionConfirm: confirm.transition,
        container: {
          historyRepository: {
            deleteProgressByKey: (key: string) => calls.push(`episode:${key}`),
            deleteTitle: (titleId: string) => calls.push(`title:${titleId}`),
          },
          // SAFETY: this test double is intentionally narrowed to the exact contract exercised here.
          // SAFETY: deliberately partial test fixture narrowed to the contract exercised here.
          // oxlint-disable-next-line anti-slop(require-safety-comment-for-type-assertion) -- justified partial test fixture
        } as never,
        onHistoryMutated: () => calls.push("mutated"),
      }),
    );
    expect(calls).toEqual(["episode:tmdb:1:1:2", "mutated"]);
    expect(confirm.state).toEqual({ kind: "idle" });
  });

  test("a second x re-arms but never executes", () => {
    const calls: string[] = [];
    const confirm = armedConfirmStripHarness();
    handleHistoryOverlayInput(
      "x",
      {},
      baseCtx({
        confirmState: confirm.state,
        transitionConfirm: confirm.transition,
        container: {
          historyRepository: {
            deleteProgressByKey: () => calls.push("episode"),
            deleteTitle: () => calls.push("title"),
          },
          // SAFETY: this test double is intentionally narrowed to the exact contract exercised here.
          // SAFETY: deliberately partial test fixture narrowed to the contract exercised here.
          // oxlint-disable-next-line anti-slop(require-safety-comment-for-type-assertion) -- justified partial test fixture
        } as never,
      }),
    );
    expect(calls).toEqual([]);
    expect(confirm.state.kind).toBe("armed");
  });

  test("Esc cancels without mutating", () => {
    const calls: string[] = [];
    const confirm = armedConfirmStripHarness();
    handleHistoryOverlayInput(
      "",
      { escape: true },
      baseCtx({
        confirmState: confirm.state,
        transitionConfirm: confirm.transition,
        container: {
          historyRepository: {
            deleteProgressByKey: () => calls.push("episode"),
            deleteTitle: () => calls.push("title"),
          },
          // SAFETY: this test double is intentionally narrowed to the exact contract exercised here.
          // SAFETY: deliberately partial test fixture narrowed to the contract exercised here.
          // oxlint-disable-next-line anti-slop(require-safety-comment-for-type-assertion) -- justified partial test fixture
        } as never,
        onHistoryMutated: () => calls.push("mutated"),
      }),
    );
    expect(calls).toEqual([]);
    expect(confirm.state).toEqual({ kind: "idle" });
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

  test("HistoryShell hides the resume card while confirmation owns focus", () => {
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
      <HistoryShell view={view} columns={120} listWidth={80} rowWidth={76} confirmationActive />,
      { columns: 120 },
    );
    expect(frame).not.toContain("resume where you left off");
  });

  test("ConfirmStrip renders the single destructive prompt", () => {
    const confirm = armedConfirmStripHarness();
    const frame = captureFrame(<ConfirmStrip state={confirm.state} width={80} />, { columns: 100 });
    expect(frame).toContain("Delete Demo · S01E02?");
  });
});

/** Typing a title to filter must not run row actions letter by letter. */
describe("history filter focus", () => {
  test("letters are text while a filter is in progress, actions otherwise", () => {
    const armed: string[] = [];
    const typing = handleHistoryOverlayInput("x", {}, baseCtx({ filterQuery: "spy " }));
    expect(typing).toBe("not-handled");

    const confirm = createConfirmStripHarness();
    handleHistoryOverlayInput(
      "x",
      {},
      baseCtx({ confirmState: confirm.state, transitionConfirm: confirm.transition }),
    );
    if (confirm.state.kind === "armed") armed.push(confirm.state.targetId);
    expect(armed).toEqual(["episode:tmdb:1:1:2"]);
  });

  test("Ctrl+F focuses an empty filter, after which action letters are text", () => {
    let focused = false;
    const ctx = baseCtx({
      setFilterFocused: (next) => {
        focused = next;
      },
    });
    expect(handleHistoryOverlayInput("f", { ctrl: true }, ctx)).toBe("handled");
    expect(focused).toBe(true);

    const result = handleHistoryOverlayInput("w", {}, { ...ctx, filterFocused: true });
    expect(result).toBe("not-handled");
  });
});
