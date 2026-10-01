import { describe, expect, test } from "bun:test";

import {
  episodePickerMarkArmed,
  libraryFilterAcceptsText,
  nextQueueClear,
} from "@/app-shell/filter-capture";

describe("filter capture", () => {
  test("typing x or p into a library filter appends the letter and does not arm delete or protect", () => {
    expect(libraryFilterAcceptsText("x", "ex")).toBe(true);
    expect(libraryFilterAcceptsText("p", "ex")).toBe(true);
    expect(libraryFilterAcceptsText("x", "")).toBe(false);
    expect(libraryFilterAcceptsText("p", "")).toBe(false);
  });

  test("a focused filter accepts Spy x Family and Pluto", () => {
    const type = (text: string, focused: boolean) => {
      let query = "";
      for (const char of text) {
        if (!libraryFilterAcceptsText(char, query, focused || query.length > 0)) {
          throw new Error(`rejected ${char}`);
        }
        query += char;
      }
      return query;
    };
    expect(type("Spy x Family", true)).toBe("Spy x Family");
    expect(type("Pluto", true)).toBe("Pluto");
    expect(libraryFilterAcceptsText("P", "", false)).toBe(false);
  });

  test("episode picker m does not mark watched while a filter is being typed", () => {
    expect(episodePickerMarkArmed("")).toBe(true);
    expect(episodePickerMarkArmed("m")).toBe(false);
  });

  test("queue clear asks before it clears", () => {
    const armed = nextQueueClear("idle", "c");
    expect(armed).toEqual({ state: "armed", clear: false });
    expect(nextQueueClear("armed", "c")).toEqual({ state: "idle", clear: true });
    expect(nextQueueClear("armed", "j")).toEqual({ state: "idle", clear: false });
  });
});
