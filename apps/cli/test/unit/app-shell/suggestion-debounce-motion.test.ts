import { describe, expect, test } from "bun:test";

import {
  SUGGESTION_DEBOUNCE_MS,
  resolveSuggestionDebounceMs,
} from "@/app-shell/hooks/use-search-suggestions";

describe("suggestion debounce vs reduced motion", () => {
  test("KUNAI_REDUCED_MOTION does not change the default catalog debounce", () => {
    const previous = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "1";
    try {
      expect(resolveSuggestionDebounceMs()).toBe(SUGGESTION_DEBOUNCE_MS);
    } finally {
      if (previous === undefined) delete process.env.KUNAI_REDUCED_MOTION;
      else process.env.KUNAI_REDUCED_MOTION = previous;
    }
  });

  test("explicit debounce override still wins", () => {
    expect(resolveSuggestionDebounceMs(0)).toBe(0);
  });
});
