import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

test("failed bootstrap search keeps its query and offline recovery visible", async () => {
  const queries: string[] = [];
  const handle = render(
    <BrowseShell
      mode="series"
      provider="videasy"
      initialQuery="Bojack Horseman"
      initialErrorMessage="Search failed: Search service unreachable · retry or open /offline"
      placeholder="Search"
      commands={[]}
      onSearch={async (query) => {
        queries.push(query);
        return { options: [], subtitle: "0 results" };
      }}
      onResolve={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { columns: 100, rows: 32 },
  );

  try {
    expect(handle.lastFrame()).toContain("Bojack Horseman");
    expect(handle.lastFrame()).toContain("Search failed");
    expect(handle.lastFrame()).toContain("retry or open /offline");

    await act(async () => {
      handle.stdin.enqueue(["\r"]);
      await Promise.resolve();
    });

    expect(queries).toEqual(["Bojack Horseman"]);
  } finally {
    handle.unmount();
  }
});
