import { expect, test } from "bun:test";

import {
  classNameHistogram,
  formatGrowthReport,
  topGrowth,
} from "@/infra/diagnostics/heap-profiler";

// Synthetic JSC-style snapshot: 4 ints per node, class-name index at offset 2.
function fakeSnapshot(classIndices: number[], classNames: string[]) {
  const nodes: number[] = [];
  for (const ci of classIndices) nodes.push(0, 0, ci, 0);
  return { nodes, nodeClassNames: classNames };
}

test("classNameHistogram counts nodes per class name", () => {
  const snap = fakeSnapshot([1, 1, 2, 1, 0], ["root", "Object", "string"]);
  const hist = classNameHistogram(snap);
  expect(hist.get("Object")).toBe(3);
  expect(hist.get("string")).toBe(1);
  expect(hist.get("root")).toBe(1);
});

test("topGrowth ranks the biggest accumulators first", () => {
  const baseline = new Map([
    ["Object", 10],
    ["string", 100],
    ["Timer", 2],
  ]);
  const current = new Map([
    ["Object", 50000], // ← the leak
    ["string", 130],
    ["Timer", 2],
  ]);
  const top = topGrowth(baseline, current, 2);
  expect(top[0]?.name).toBe("Object");
  expect(top[0]?.delta).toBe(49990);
  expect(top[1]?.name).toBe("string");
});

test("topGrowth treats new class names as growth from zero", () => {
  const top = topGrowth(new Map(), new Map([["LeakyThing", 42]]));
  expect(top[0]).toEqual({ name: "LeakyThing", from: 0, to: 42, delta: 42 });
});

test("formatGrowthReport renders a readable summary", () => {
  const out = formatGrowthReport("cap", [{ name: "Object", from: 10, to: 5000, delta: 4990 }]);
  expect(out).toContain("top object-type growth");
  expect(out).toContain("Object (10 -> 5000)".replace("->", "→"));
});
