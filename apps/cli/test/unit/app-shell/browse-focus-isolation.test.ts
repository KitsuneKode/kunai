import { describe, expect, test } from "bun:test";

import {
  isBareBrowseLetterHotkey,
  isReservedBrowseSurfaceChord,
  shouldSuppressBrowseLetterHotkeys,
} from "@/app-shell/browse-focus-zone";
import { footerKeyFromBinding, formatChord, KEYBINDINGS } from "@/app-shell/keybindings";
import { shouldHistoryOverlayAcceptFilterInput } from "@/app-shell/overlay-input-safety";
import { handleHistoryOverlayInput } from "@/app-shell/use-history-overlay-input";

describe("browse focus isolation", () => {
  test("formatChord uses glyphs for shift and ctrl", () => {
    expect(formatChord({ input: "x", shift: true })).toBe("⇧X");
    expect(formatChord({ input: "c", ctrl: true })).toBe("⌃C");
  });

  test("footerKeyFromBinding preserves registry letter case for history delete", () => {
    const episode = KEYBINDINGS.find((binding) => binding.id === "history-delete-episode")!;
    const title = KEYBINDINGS.find((binding) => binding.id === "history-delete-title")!;
    expect(footerKeyFromBinding(episode)).toBe("x");
    expect(footerKeyFromBinding(title)).toBe("⇧X");
  });

  test("letter hotkeys are ignored while command/text input owns focus", () => {
    expect(shouldSuppressBrowseLetterHotkeys({ commandMode: true, focusZone: "list" })).toBe(true);
    expect(shouldSuppressBrowseLetterHotkeys({ commandMode: false, focusZone: "query" })).toBe(
      true,
    );
    expect(shouldSuppressBrowseLetterHotkeys({ commandMode: false, focusZone: "filter" })).toBe(
      true,
    );
    expect(shouldSuppressBrowseLetterHotkeys({ commandMode: false, focusZone: "list" })).toBe(
      false,
    );

    expect(isBareBrowseLetterHotkey("e", {})).toBe(true);
    expect(isBareBrowseLetterHotkey("h", {})).toBe(true);
    expect(isBareBrowseLetterHotkey("E", { shift: true })).toBe(false);
    expect(isBareBrowseLetterHotkey("c", { ctrl: true })).toBe(false);

    expect(isReservedBrowseSurfaceChord("c", { ctrl: true })).toBe(true);
    expect(isReservedBrowseSurfaceChord("/", {})).toBe(true);
    expect(isReservedBrowseSurfaceChord("", { escape: true })).toBe(true);
    expect(isReservedBrowseSurfaceChord("e", {})).toBe(false);
  });

  test("history confirm y does not fall through to browse search editor", () => {
    expect(
      shouldHistoryOverlayAcceptFilterInput({
        overlayType: "history",
        pendingDelete: { kind: "episode", key: "tmdb:1:1:2", label: "Demo · S01E02" },
        sourceChoiceTitleId: null,
      }),
    ).toBe(false);

    const filterMutations: string[] = [];
    const result = handleHistoryOverlayInput(
      "y",
      {},
      {
        container: {
          historyRepository: {
            deleteProgressByKey: (key: string) => filterMutations.push(`episode:${key}`),
            deleteTitle: () => filterMutations.push("title"),
          },
        } as never,
        historyView: { flatRows: [{ titleId: "tmdb:1", dualSourceAvailable: false }] },
        historySelections: [
          {
            titleId: "tmdb:1",
            entry: {
              key: "tmdb:1:1:2",
              titleId: "tmdb:1",
              mediaKind: "series",
              title: "Demo",
              season: 1,
              episode: 2,
              positionSeconds: 120,
              durationSeconds: 1200,
              completed: false,
              updatedAt: "2026-06-22T00:00:00.000Z",
              createdAt: "2026-06-22T00:00:00.000Z",
            },
          },
        ],
        historyPickerContext: {},
        selectedIndex: 0,
        sourceChoiceTitleId: null,
        sourcePreference: "auto",
        setSourceChoiceTitleId: () => {},
        setHistoryTypeFilter: () => {},
        setHistoryTab: () => {},
        setSelectedIndex: () => {},
        setOverlayStatus: () => {},
        onRedraw: () => {},
        pendingDelete: { kind: "episode", key: "tmdb:1:1:2", label: "Demo · S01E02" },
        setPendingDelete: () => {},
        onHistoryMutated: () => filterMutations.push("mutated"),
        onConfirmSelection: () => {},
      },
    );

    expect(result).toBe("handled");
    expect(filterMutations).toEqual(["episode:tmdb:1:1:2", "mutated"]);
  });
});
