import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CYCLE, countsOf, fails, frameOf } from "../components/iso/resolve-gate/rig";
import { PLUNGER_HOME, PLUNGER_TOUCH, PROBE_X, SLOT_X } from "../components/iso/resolve-gate/view";

const root = new URL("../", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("the resolve gate figure", () => {
  test("is registered for MDX and mounted on the providers page", () => {
    expect(read("mdx-components.tsx")).toContain("ResolveGateFigure");
    expect(readFileSync(`${root}../../docs/users/providers.mdx`, "utf8")).toContain(
      "<ResolveGateFigure />",
    );
  });

  test("the model is deterministic — same clock, same frame", () => {
    for (const t of [0, 1.7, 4.2, CYCLE * 3 + 2.9, CYCLE * 11 + 0.4]) {
      expect(frameOf(t)).toEqual(frameOf(t));
    }
  });

  test("the verdict pattern fails some and passes most", () => {
    const verdicts = Array.from({ length: 20 }, (_, i) => fails(i));
    const dropped = verdicts.filter(Boolean).length;
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(10);
  });

  test("a candidate travels slot → gate, gets stamped, then routes", () => {
    const travel = frameOf(0.7);
    expect(travel.tokenX).toBeGreaterThan(SLOT_X);
    expect(travel.tokenX).toBeLessThan(PROBE_X);
    expect(travel.plunger).toBe(PLUNGER_HOME);

    const pressed = frameOf(2.4);
    expect(pressed.tokenX).toBe(PROBE_X);
    expect(pressed.plunger).toBe(PLUNGER_TOUCH);
  });

  test("a failed candidate tips into the dead hopper, a pass rides out", () => {
    // Find a failing index and a passing one, then check Exit phase poses.
    const failAt = Array.from({ length: 20 }, (_, i) => i).find((i) => fails(i))!;
    const passAt = Array.from({ length: 20 }, (_, i) => i).find((i) => !fails(i))!;
    const failFrame = frameOf(failAt * CYCLE + CYCLE - 0.05);
    expect(failFrame.verdict).toBe(false);
    expect(failFrame.tipSide).toBeGreaterThan(0.8);
    const passFrame = frameOf(passAt * CYCLE + CYCLE - 0.4);
    expect(passFrame.verdict).toBe(true);
    expect(passFrame.tokenX).toBeGreaterThan(PROBE_X);
    expect(passFrame.glow).toBe(1);
  });

  test("the readout counts what the reader watched", () => {
    const counts = countsOf(CYCLE * 6.2);
    expect(counts.probed).toBe(counts.passed + counts.dropped);
    expect(counts.probed).toBeGreaterThanOrEqual(6);
  });

  test("the figure re-paints with the coat through kunai tokens", () => {
    const css = read("components/iso/resolve-gate/resolve-gate.css");
    expect(css).toContain("--anatomy-lit: var(--kunai-accent)");
    expect(css).toContain("--kunai-danger");
  });

  test("the live layer drives motion from the model, not CSS", () => {
    const live = read("components/iso/resolve-gate/live.tsx");
    expect(live).toContain("frameOf");
    expect(live).toContain("requestAnimationFrame");
    expect(live).toContain("IntersectionObserver");
    expect(live).toContain("asksForStillness");
  });
});
