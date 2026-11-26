import { describe, expect, test } from "bun:test";

import { routeListFilterKey } from "@/app-shell/list-filter-keys";

const LIBRARY = new Set(["x", "X", "p", "P", "2", "z"]);
const route = (input: string, focused: boolean, query: string, key = {}) =>
  routeListFilterKey(input, key, { focused, query, actionKeys: LIBRARY });

describe("routeListFilterKey", () => {
  test("an action key acts only when nothing is being filtered", () => {
    expect(route("x", false, "")).toBe("action");
    // "Spy x Family": the x mid-filter is text, not a delete.
    expect(route("x", false, "spy ")).toBe("append");
    expect(route("2", true, "")).toBe("append");
  });

  test("Ctrl+F opens the filter; / stays the palette's and is text inside a filter", () => {
    expect(route("f", false, "", { ctrl: true })).toBe("focus");
    expect(route("/", false, "")).toBe("not-text");
    expect(route("/", true, "a")).toBe("append");
  });

  test("an unbound letter starts the filter; non-printable keys stay with the caller", () => {
    expect(route("d", false, "")).toBe("append");
    expect(route("\r", false, "", { return: true })).toBe("not-text");
    expect(route("a", false, "", { ctrl: true })).toBe("not-text");
    expect(route("\u001b", true, "x", { escape: true })).toBe("not-text");
  });
});
