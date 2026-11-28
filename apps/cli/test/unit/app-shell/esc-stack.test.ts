import { describe, expect, test } from "bun:test";

import { resolveEscStack, type EscLayer } from "@/app-shell/esc-stack";

function layer(kind: EscLayer["kind"]): EscLayer {
  // SAFETY: every non-filter kind in this union has no extra fields.
  return kind === "filter" ? { kind, query: "frieren" } : ({ kind } as EscLayer);
}

describe("resolveEscStack", () => {
  test.each([
    ["confirm", "prompt", "cancel-confirmation"],
    ["prompt", "filter", "cancel-prompt"],
    ["filter", "nested-pane", "clear-filter"],
    ["nested-pane", "picker", "exit-pane"],
    ["picker", "surface-owned", "cancel-picker"],
    ["surface-owned", "overlay", "defer-to-surface"],
    ["overlay", "route", "close-overlay"],
  ] as const)("%s beats %s", (higher, lower, expected) => {
    expect(resolveEscStack([layer(lower), layer(higher)])).toBe(expected);
    expect(resolveEscStack([layer(higher), layer(lower)])).toBe(expected);
  });

  test("an armed confirmation beats a typed filter", () => {
    expect(resolveEscStack([{ kind: "filter", query: "frieren" }, { kind: "confirm" }])).toBe(
      "cancel-confirmation",
    );
  });

  test("an empty filter query is not a layer", () => {
    expect(resolveEscStack([{ kind: "filter", query: "" }, { kind: "overlay" }])).toBe(
      "close-overlay",
    );
  });

  test("cancelActive=false defers lower layers to the owning editor", () => {
    expect(
      resolveEscStack([{ kind: "filter", query: "abc" }, { kind: "overlay" }], {
        cancelActive: false,
      }),
    ).toBe("no-op");
  });

  test("cancelActive=false never leaves an armed confirmation stuck", () => {
    expect(
      resolveEscStack([{ kind: "confirm" }, { kind: "overlay" }], { cancelActive: false }),
    ).toBe("cancel-confirmation");
  });

  test("returns route history only when route is the outermost declared layer", () => {
    expect(resolveEscStack([{ kind: "route" }])).toBe("back-route");
    expect(resolveEscStack([{ kind: "route" }, { kind: "overlay" }])).toBe("close-overlay");
  });

  test("empty stack is a no-op", () => {
    expect(resolveEscStack([])).toBe("no-op");
  });
});
