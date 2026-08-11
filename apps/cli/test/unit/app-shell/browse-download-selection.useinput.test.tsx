import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseShellOption, ShellAction } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import React from "react";

import { render } from "../../harness/render-capture";

const DOWN = `${String.fromCharCode(27)}[B`;
const CTRL_D = String.fromCharCode(4);

function trendingOption(label: string): BrowseShellOption<SearchResult> {
  return {
    label,
    value: {
      id: label,
      type: "series",
      title: label,
      year: "2026",
      overview: "",
      posterPath: null,
    },
  };
}

type Resolved = Array<{ action: ShellAction; value?: SearchResult }>;

/**
 * The download target is read out of session state, whose selected index is
 * reset to 0 on every results load. Browse tracks its cursor in local state, so
 * unless the download action carries the highlighted row, every Ctrl+D on a
 * trending list downloads the first item regardless of where the cursor is.
 */
function renderTrendingBrowse(resolved: Resolved) {
  return render(
    <BrowseShell
      mode="series"
      provider="vidking"
      initialResults={[
        trendingOption("First trending"),
        trendingOption("Second trending"),
        trendingOption("Third trending"),
      ]}
      initialResultSubtitle="3 trending"
      placeholder="Search"
      commands={[]}
      onSearch={async () => ({ options: [], subtitle: "", emptyMessage: "" })}
      onResolve={(action, value) => resolved.push({ action, value })}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 120, rows: 30 },
  );
}

// Keys go in one at a time: the harness delivers an array as a single read,
// which the shell sees as one keypress rather than a burst of arrows.
function press(handle: ReturnType<typeof renderTrendingBrowse>, keys: readonly string[]): void {
  for (const key of keys) handle.stdin.enqueue([key]);
}

test("Ctrl+D carries the highlighted trending row, not the first one", () => {
  const resolved: Resolved = [];
  const handle = renderTrendingBrowse(resolved);

  try {
    press(handle, [DOWN, DOWN, CTRL_D]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.action).toBe("download");
    expect(resolved[0]?.value?.title).toBe("Third trending");
  } finally {
    handle.unmount();
  }
});

test("bare d in the results zone carries the highlighted row too", () => {
  const resolved: Resolved = [];
  const handle = renderTrendingBrowse(resolved);

  try {
    press(handle, [DOWN, "d"]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.action).toBe("download");
    expect(resolved[0]?.value?.title).toBe("Second trending");
  } finally {
    handle.unmount();
  }
});

test("download without moving the cursor still names the first row explicitly", () => {
  const resolved: Resolved = [];
  const handle = renderTrendingBrowse(resolved);

  try {
    press(handle, [CTRL_D]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.action).toBe("download");
    expect(resolved[0]?.value?.title).toBe("First trending");
  } finally {
    handle.unmount();
  }
});
