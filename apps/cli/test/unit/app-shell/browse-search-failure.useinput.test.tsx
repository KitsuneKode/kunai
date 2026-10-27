import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowseShell } from "@/app-shell/browse-shell";
import { kunaiConfigDir } from "@/infra/storage/kunai-paths";
import { flushSearchHistory } from "@/services/persistence/search-history";
import React, { act } from "react";

import { render } from "../../harness/render-capture";
import { applyStorageRootEnv } from "../../helpers/storage-env";

test("failed bootstrap search keeps its query and offline recovery visible", async () => {
  // BrowseShell saves the query it submits to search history, so Enter below writes a file.
  // That must land in a throwaway profile, never the developer's real one: this test used to
  // write "Bojack Horseman" into ~/.config/kunai/search-history.json on every multi-file run.
  const sandbox = mkdtempSync(join(tmpdir(), "kunai-browse-search-failure-"));
  const restoreEnv = applyStorageRootEnv(sandbox);
  const historyFile = join(kunaiConfigDir(), "search-history-series.json");
  expect(historyFile.startsWith(sandbox)).toBe(true);

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
    // Observe the writer completing instead of racing a wall-clock deadline.
    await flushSearchHistory();
    expect(JSON.parse(readFileSync(historyFile, "utf8"))).toEqual(["Bojack Horseman"]);
    expect(existsSync(join(kunaiConfigDir(), "search-history-youtube.json"))).toBe(false);
  } finally {
    handle.unmount();
    restoreEnv();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
