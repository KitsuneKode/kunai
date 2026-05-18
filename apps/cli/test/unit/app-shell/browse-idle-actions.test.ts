import { describe, expect, test } from "bun:test";

import { resolveIdleContinueAction } from "@/app-shell/browse-idle-actions";

describe("browse idle actions", () => {
  test("inline continue rows resume the shown title instead of opening the global continue menu", () => {
    expect(
      resolveIdleContinueAction({
        continueWatching: {
          title: "The WONDERfools",
          ep: "S01E04",
          titleId: "tmdb:123",
          mediaKind: "series",
        },
      }),
    ).toBe("resume-continue-watching");
  });

  test("missing inline history target falls back to the global continue surface", () => {
    expect(resolveIdleContinueAction(undefined)).toBe("continue");
  });
});
