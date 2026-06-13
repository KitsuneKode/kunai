import { describe, expect, test } from "bun:test";

import {
  buildBrowseIdleReturnLoopModel,
  resolveIdleContinueAction,
} from "@/app-shell/browse-idle-actions";

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

  test("buildBrowseIdleReturnLoopModel surfaces catalog-new episodes without personalizing them", () => {
    const model = buildBrowseIdleReturnLoopModel(
      {
        continueWatching: {
          title: "In Progress",
          ep: "S01E02",
          titleId: "tmdb:1",
          mediaKind: "series",
        },
        todayReleaseCount: 2,
        todayReleaseTitleCount: 1,
      },
      { idleFocused: true },
    );
    expect(model?.rows.map((row) => row.id)).toEqual(["continue", "ready-now"]);
    expect(model?.rows[0]?.hint).toBe("↵ resume first");
    expect(model?.rows[1]?.title).toBe("Unwatched releases");
    expect(model?.rows[1]?.meta).toBe("2 new episodes · 1 show");
  });
});
