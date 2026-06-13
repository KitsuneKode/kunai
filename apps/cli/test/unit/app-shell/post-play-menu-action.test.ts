import { describe, expect, test } from "bun:test";

import {
  isPostPlayConfirmInput,
  isPostPlayPlaybackRestartResult,
  resolvePostPlayMenuAction,
} from "@/app-shell/post-play-view";

describe("post-play menu actions", () => {
  test("resolvePostPlayMenuAction maps resume and next distinctly", () => {
    expect(
      resolvePostPlayMenuAction({
        id: "resume",
        label: "Resume",
        detail: "",
        shortcut: "↵",
        primary: true,
      }),
    ).toBe("resume");
    expect(
      resolvePostPlayMenuAction({
        id: "next",
        label: "Next episode",
        detail: "",
        shortcut: "↵ n",
        primary: true,
      }),
    ).toBe("next");
    expect(
      resolvePostPlayMenuAction({
        id: "bookmark",
        label: "Bookmark",
        detail: "",
        shortcut: "w",
        primary: true,
      }),
    ).toBe("bookmark");
    expect(
      resolvePostPlayMenuAction({
        id: "session-controls",
        label: "Session",
        detail: "",
        shortcut: "a",
        primary: false,
      }),
    ).toBeNull();
  });

  test("isPostPlayPlaybackRestartResult covers resume and replay", () => {
    expect(isPostPlayPlaybackRestartResult("resume")).toBe(true);
    expect(isPostPlayPlaybackRestartResult("next")).toBe(true);
    expect(isPostPlayPlaybackRestartResult("search")).toBe(false);
    expect(isPostPlayPlaybackRestartResult({ type: "track-selection", pick: {} as never })).toBe(
      false,
    );
  });

  test("isPostPlayConfirmInput accepts return and carriage return", () => {
    expect(isPostPlayConfirmInput("", { return: true })).toBe(true);
    expect(isPostPlayConfirmInput("\r", { return: false })).toBe(true);
    expect(isPostPlayConfirmInput("\n", { return: false })).toBe(true);
    expect(isPostPlayConfirmInput("c", { return: false })).toBe(false);
  });
});
