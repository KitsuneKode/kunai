import { describe, expect, test } from "bun:test";

import {
  formatMobileChoiceOptions,
  interpretMobileChoiceAnswer,
  MOBILE_INVALID_SELECTION,
} from "../../../src/application/mobile-choice";

const request = {
  prompt: "Continue?",
  choices: [
    { value: "continue", label: "Run proof" },
    { value: "cancel", label: "Cancel explicitly" },
  ],
} as const;

describe("mobile choice policy", () => {
  test("owns portable numbering, cancellation, and retry copy", () => {
    expect(formatMobileChoiceOptions(request)).toBe(
      "1. Run proof\n2. Cancel explicitly\n0. Cancel\n",
    );
    expect(MOBILE_INVALID_SELECTION).toBe("Invalid selection. Try again.\n");
  });

  test("accepts a number or exact value", () => {
    expect(interpretMobileChoiceAnswer(request, "1")).toEqual({
      kind: "selected",
      value: "continue",
    });
    expect(interpretMobileChoiceAnswer(request, "cancel")).toEqual({
      kind: "selected",
      value: "cancel",
    });
  });

  test("trims host padding before interpreting an answer", () => {
    // a-Shell's `read -r` keeps whatever the soft keyboard produced.
    for (const padded of [" 1", "1 ", "\t1", " 1 \t"]) {
      expect(interpretMobileChoiceAnswer(request, padded)).toEqual({
        kind: "selected",
        value: "continue",
      });
    }
    expect(interpretMobileChoiceAnswer(request, " cancel ")).toEqual({
      kind: "selected",
      value: "cancel",
    });
    for (const blank of ["   ", " 0 "]) {
      expect(interpretMobileChoiceAnswer(request, blank)).toEqual({ kind: "cancelled" });
    }
    expect(interpretMobileChoiceAnswer(request, "0 1")).toEqual({ kind: "invalid" });
  });

  test("classifies empty, zero, invalid, and unsafe numeric input", () => {
    expect(interpretMobileChoiceAnswer(request, undefined)).toEqual({ kind: "cancelled" });
    expect(interpretMobileChoiceAnswer(request, "")).toEqual({ kind: "cancelled" });
    expect(interpretMobileChoiceAnswer(request, "0")).toEqual({ kind: "cancelled" });
    expect(interpretMobileChoiceAnswer(request, "3")).toEqual({ kind: "invalid" });
    expect(interpretMobileChoiceAnswer(request, "9007199254740992")).toEqual({
      kind: "invalid",
    });
  });
});
