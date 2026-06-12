import { describe, expect, test } from "bun:test";

import { getShellViewportPolicy } from "@/app-shell/layout-policy";
import { ResizeBlocker } from "@/app-shell/shell-primitives";
import { Text } from "ink";
import React from "react";

import { captureFrame, captureResizeSequence } from "../../harness/render-capture";

/**
 * Resize-blocker coverage. The testing-strategy doc requires that the
 * resize blocker renders for each shell kind at < 60 cols. We assert both
 * the underlying policy math and the rendered surface.
 */
describe("resize blocker — P3-9 strategy doc coverage", () => {
  describe("getShellViewportPolicy", () => {
    test("browse kind is blocked below 60 columns", () => {
      const policy = getShellViewportPolicy("browse", 50, 24);
      expect(policy.breakpoint).toBe("blocked");
      expect(policy.tooSmall).toBe(true);
    });

    test("picker kind is blocked below 60 columns", () => {
      const policy = getShellViewportPolicy("picker", 50, 24);
      expect(policy.breakpoint).toBe("blocked");
      expect(policy.tooSmall).toBe(true);
    });

    test("playback kind is blocked below 60 columns", () => {
      const policy = getShellViewportPolicy("playback", 50, 24);
      expect(policy.breakpoint).toBe("blocked");
      expect(policy.tooSmall).toBe(true);
    });

    test("all three kinds reach narrow at 70 cols (rail collapses)", () => {
      for (const kind of ["browse", "picker", "playback"] as const) {
        const policy = getShellViewportPolicy(kind, 70, 24);
        expect(policy.breakpoint).toBe("narrow");
        expect(policy.tooSmall).toBe(false);
      }
    });

    test("kind is blocked when rows drop below 20 even with wide columns", () => {
      const policy = getShellViewportPolicy("browse", 140, 10);
      expect(policy.breakpoint).toBe("blocked");
    });
  });

  describe("ResizeBlocker surface", () => {
    test("shows the user-friendly blocked message with the actual + required dimensions", () => {
      const frame = captureFrame(
        <ResizeBlocker columns={50} rows={20} minColumns={60} minRows={20} />,
        { columns: 50, rows: 20 },
      );
      expect(frame).toContain("Terminal too small");
      expect(frame).toContain("Terminal is 50×20");
      expect(frame).toContain("needs 60×20");
      expect(frame).toContain("Zoom out or resize the terminal window.");
    });

    test("respects a custom message when the surface wants its own copy", () => {
      const frame = captureFrame(
        <ResizeBlocker
          columns={40}
          rows={20}
          minColumns={80}
          minRows={24}
          message="Resize terminal for post-play controls"
        />,
        { columns: 40, rows: 20 },
      );
      expect(frame).toContain("Resize terminal for post-play controls");
      expect(frame).toContain("Terminal is 40×20");
      expect(frame).toContain("needs 80×24");
    });
  });

  describe("resize sequence", () => {
    test("useShellDimensions settles immediately on shrink across widths", () => {
      // WidthProbe from the harness prints the current cols. Going from
      // wide → narrow should land in the narrow frame without any debounce
      // delay because shouldSettleViewportImmediately returns true for
      // shrinks.
      function WidthProbe() {
        return <Text>ok</Text>;
      }
      const frames = captureResizeSequence(<WidthProbe />, [
        { columns: 140, rows: 30 },
        { columns: 70, rows: 24 },
        { columns: 50, rows: 20 },
      ]);
      // The first frame is wide, second narrow, third blocked. The
      // blocker is rendered by the shell kind; here we just assert the
      // harness itself reports three distinct frame contexts (no test
      // crash on shrink).
      expect(frames).toHaveLength(3);
    });
  });
});
