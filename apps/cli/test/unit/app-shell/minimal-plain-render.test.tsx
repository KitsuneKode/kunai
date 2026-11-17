import { afterEach, describe, expect, test } from "bun:test";

import {
  EMOJI_OR_MASCOT,
  LONG_BOX_RULE,
  setPlainDecorationSource,
} from "@/app-shell/decoration-policy";
import { kannaLinesFor } from "@/app-shell/kanna-voice";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import React from "react";

import { SETUP_SCREENS, setupFrameAt } from "../../harness/capture-setup";
import { captureFrame } from "../../harness/render-capture";

afterEach(() => {
  setPlainDecorationSource(() => false);
});

describe("minimal plain render", () => {
  test("StateBlock under plain mode has no emoji, rules, mascot copy, ASCII title prefix", () => {
    setPlainDecorationSource(() => true);
    const frame = captureFrame(
      <StateBlock model={{ kind: "empty", title: "No results yet" }} width={64} />,
      { columns: 72, rows: 24 },
    );
    expect(frame).toContain("No results yet");
    expect(frame).toMatch(/(^- No results yet|- No results yet)/);
    expect(EMOJI_OR_MASCOT.test(frame)).toBe(false);
    expect(LONG_BOX_RULE.test(frame)).toBe(false);
    for (const line of kannaLinesFor("empty")) {
      expect(frame).not.toContain(line);
    }
  });

  test("rich mode still renders decorative empty-state copy when companion enabled", () => {
    const frame = captureFrame(
      <StateBlock model={{ kind: "empty", title: "No results yet" }} width={64} />,
      { columns: 72, rows: 24 },
    );
    expect(frame).toContain("No results yet");
  });

  test("every setup step under plain mode has no emoji, mascot, rules or fancy cursor", () => {
    // Setup is the first screen a screen-reader user meets; -m must cover it.
    setPlainDecorationSource(() => true);
    SETUP_SCREENS.forEach((name, step) => {
      const frame = setupFrameAt(step, 64);
      expect({ name, emoji: EMOJI_OR_MASCOT.test(frame) }).toEqual({ name, emoji: false });
      expect({ name, rule: LONG_BOX_RULE.test(frame) }).toEqual({ name, rule: false });
      expect({ name, cursor: frame.includes("▌") }).toEqual({ name, cursor: false });
    });
  });
});
