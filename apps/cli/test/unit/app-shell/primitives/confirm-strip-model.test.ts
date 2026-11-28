import { describe, expect, test } from "bun:test";

import {
  confirmStripBlocksPointer,
  confirmStripFooterActions,
  confirmStripKeyDecision,
  idleConfirmStripState,
  isPlainConfirmKey,
  transitionConfirmStrip,
} from "@/app-shell/primitives/ConfirmStrip.model";

const ids = ["row-a", "row-b", "row-c"];

function arm(targetId = "row-a") {
  return transitionConfirmStrip(idleConfirmStripState, {
    type: "arm",
    targetId,
    label: "Frieren (4 local files, 1.4 GB)",
    verb: "delete files",
    visibleIds: ids,
  }).state;
}

describe("ConfirmStrip model", () => {
  test("arms with a stable target id and no index", () => {
    const state = arm("row-b");
    expect(state).toMatchObject({ kind: "armed", targetId: "row-b", verb: "delete files" });
  });

  test("confirm enters executing and returns an immutable execute effect", () => {
    const armed = arm();
    const result = transitionConfirmStrip(armed, { type: "confirm" });
    expect(result.state).toMatchObject({ kind: "executing", targetId: "row-a" });
    expect(result.effect).toEqual({
      type: "execute",
      targetId: "row-a",
      label: "Frieren (4 local files, 1.4 GB)",
      verb: "delete files",
    });
  });

  test("cancel disarms without producing an execute effect", () => {
    const result = transitionConfirmStrip(arm(), { type: "cancel" });
    expect(result.state).toEqual(idleConfirmStripState);
    expect(result.effect).toBeUndefined();
  });

  test("executing ignores confirm and cancel input", () => {
    const executing = transitionConfirmStrip(arm(), { type: "confirm" }).state;
    const confirmed = transitionConfirmStrip(executing, { type: "confirm" });
    const cancelled = transitionConfirmStrip(executing, { type: "cancel" });
    expect(confirmed.state).toBe(executing);
    expect(cancelled.state).toBe(executing);
    expect(confirmed.effect).toBeUndefined();
    expect(cancelled.effect).toBeUndefined();
  });

  test("succeed returns to idle only from executing", () => {
    const executing = transitionConfirmStrip(arm(), { type: "confirm" }).state;
    expect(transitionConfirmStrip(executing, { type: "succeed" }).state).toEqual(
      idleConfirmStripState,
    );
    expect(transitionConfirmStrip(arm(), { type: "succeed" }).state).toMatchObject({
      kind: "armed",
    });
  });

  test("fail preserves the failed message until dismissed", () => {
    const executing = transitionConfirmStrip(arm(), { type: "confirm" }).state;
    const failed = transitionConfirmStrip(executing, {
      type: "fail",
      message: "artifact is still in use",
    }).state;
    expect(failed).toMatchObject({ kind: "failed", message: "artifact is still in use" });
    expect(transitionConfirmStrip(failed, { type: "cancel" }).state).toEqual(idleConfirmStripState);
  });

  test("reconcile disarms when the target row disappears", () => {
    expect(
      transitionConfirmStrip(arm("row-b"), { type: "reconcile", visibleIds: ["row-a", "row-c"] })
        .state,
    ).toEqual(idleConfirmStripState);
  });

  test("reconcile disarms when row order changes", () => {
    expect(
      transitionConfirmStrip(arm(), { type: "reconcile", visibleIds: ["row-b", "row-a", "row-c"] })
        .state,
    ).toEqual(idleConfirmStripState);
  });

  test("reconcile keeps an unchanged target armed", () => {
    const armed = arm();
    expect(transitionConfirmStrip(armed, { type: "reconcile", visibleIds: ids }).state).toBe(armed);
  });

  test("armed footer exposes only y plus escape and explicit mouse opt-in", () => {
    expect(confirmStripFooterActions(arm())).toEqual([
      expect.objectContaining({ key: "y", label: "delete files", allowMouseDestructive: true }),
      expect.objectContaining({ key: "esc", label: "cancel", allowMouseDestructive: true }),
    ]);
  });

  test("modified y is not a confirmation", () => {
    expect(isPlainConfirmKey("y", {})).toBe(true);
    expect(isPlainConfirmKey("Y", {})).toBe(true);
    expect(isPlainConfirmKey("y", { ctrl: true })).toBe(false);
    expect(isPlainConfirmKey("y", { meta: true })).toBe(false);
    expect(isPlainConfirmKey("y", { shift: true })).toBe(false);
  });

  test("vertical arrows cancel and continue; a failure holds until Escape", () => {
    expect(confirmStripKeyDecision("armed", "y", { ctrl: true })).toBe("hold");
    expect(
      confirmStripKeyDecision("armed", "", { downArrow: true }, { continueOnVerticalArrows: true }),
    ).toBe("cancel-and-continue");
    expect(confirmStripKeyDecision("armed", "", { downArrow: true })).toBe("cancel");
    expect(confirmStripKeyDecision("failed", "", { downArrow: true })).toBe("hold");
    expect(confirmStripKeyDecision("executing", "", { downArrow: true })).toBe("hold");
  });

  test("pointer actions are blocked only while executing", () => {
    expect(confirmStripBlocksPointer("executing")).toBe(true);
    expect(confirmStripBlocksPointer("armed")).toBe(false);
    expect(confirmStripBlocksPointer("failed")).toBe(false);
    expect(confirmStripBlocksPointer("idle")).toBe(false);
  });

  test("failed footer exposes only escape dismiss", () => {
    const executing = transitionConfirmStrip(arm(), { type: "confirm" }).state;
    const failed = transitionConfirmStrip(executing, { type: "fail", message: "kept" }).state;
    expect(confirmStripFooterActions(failed)).toEqual([
      expect.objectContaining({ key: "esc", label: "dismiss" }),
    ]);
  });
});
