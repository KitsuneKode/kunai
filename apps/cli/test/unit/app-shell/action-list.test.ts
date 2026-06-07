import { describe, expect, test } from "bun:test";

import {
  type ActionRowModel,
  getEnabledActionRows,
  normalizeActionShortcut,
} from "@/app-shell/primitives/ActionList.model";

describe("ActionList helpers", () => {
  const rows: readonly ActionRowModel[] = [
    { id: "recover", label: "Recover", detail: "Refresh stream", shortcut: "r" },
    { id: "fallback", label: "Fallback", detail: "Try another provider", shortcut: "f" },
    {
      id: "next",
      label: "Next episode",
      detail: "Disabled for unresolved failure",
      shortcut: "n",
      disabledReason: "Playback has not recovered yet",
    },
  ];

  test("filters disabled rows when requested", () => {
    expect(getEnabledActionRows(rows).map((row) => row.id)).toEqual(["recover", "fallback"]);
  });

  test("normalizes shortcuts without brackets", () => {
    expect(normalizeActionShortcut("[r]")).toBe("r");
    expect(normalizeActionShortcut("r")).toBe("r");
  });
});
