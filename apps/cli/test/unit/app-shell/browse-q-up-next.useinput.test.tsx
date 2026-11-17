import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseShellOption, ShellAction } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import React from "react";

import { render } from "../../harness/render-capture";

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

function renderBrowse(input: {
  readonly queued: SearchResult[];
  readonly initialResults?: readonly BrowseShellOption<SearchResult>[];
}) {
  const resolved: Array<{ action: ShellAction; value?: SearchResult }> = [];
  const handle = render(
    <BrowseShell
      mode="series"
      provider="vidking"
      initialResults={input.initialResults}
      initialResultSubtitle={
        input.initialResults && input.initialResults.length > 0 ? "1 trending" : undefined
      }
      placeholder="Search"
      commands={[]}
      onSearch={async () => ({ options: [], subtitle: "", emptyMessage: "" })}
      onResolve={(action, value) => resolved.push({ action, value })}
      onSubmit={() => {}}
      onCancel={() => {}}
      onQueueSelected={(value) => {
        input.queued.push(value);
      }}
    />,
    { columns: 120, rows: 30 },
  );
  return { handle, resolved };
}

test("u on the results list adds to Up Next; q backs out without enqueueing", () => {
  const queued: SearchResult[] = [];
  const { handle } = renderBrowse({
    queued,
    initialResults: [trendingOption("Smoke title")],
  });

  try {
    handle.stdin.enqueue(["u"]);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.title).toBe("Smoke title");

    handle.stdin.enqueue(["q"]);
    expect(queued).toHaveLength(1);
  } finally {
    handle.unmount();
  }
});

test("typing q in the search field inserts the character", () => {
  const queued: SearchResult[] = [];
  const { handle } = renderBrowse({ queued });

  try {
    handle.stdin.enqueue(["q"]);
    expect(queued).toEqual([]);
    expect(handle.lastFrame()).toContain("q");
  } finally {
    handle.unmount();
  }
});
