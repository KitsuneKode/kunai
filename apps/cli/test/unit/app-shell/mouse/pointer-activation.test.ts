import { describe, expect, test } from "bun:test";

import { pointerClickIntent } from "@/app-shell/mouse/pointer-activation";

describe("pointer click intent", () => {
  test("the first click on a row only selects it, including a preselected row", () => {
    expect(pointerClickIntent(null, "a", true)).toEqual({ intent: "select", priorKey: "a" });
    expect(pointerClickIntent(null, "b", false)).toEqual({ intent: "select", priorKey: "b" });
  });

  test("a second click on the same selected row activates it", () => {
    expect(pointerClickIntent("a", "a", true)).toEqual({ intent: "activate", priorKey: null });
  });

  test("moving to another row selects that row instead of activating it", () => {
    expect(pointerClickIntent("a", "b", false)).toEqual({ intent: "select", priorKey: "b" });
    expect(pointerClickIntent("a", "b", true)).toEqual({ intent: "select", priorKey: "b" });
  });
});
