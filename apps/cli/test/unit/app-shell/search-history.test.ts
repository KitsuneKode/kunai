import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addSearchQuery,
  clearSearchHistoryCacheForTest,
  flushSearchHistoryForTest,
  getSearchHistory,
} from "@/app-shell/search-history";

let homeDir: string;
let savedHome: string | undefined;
let savedXdg: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "kunai-search-history-"));
  savedHome = process.env.HOME;
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = homeDir;
  delete process.env.XDG_CONFIG_HOME;
  clearSearchHistoryCacheForTest();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  clearSearchHistoryCacheForTest();
});

function historyFile(): string {
  return join(homeDir, ".config", "kunai", "search-history.json");
}

function readDisk(): string[] {
  // SAFETY: test-only read of a file this suite wrote — shape asserted below.
  return JSON.parse(readFileSync(historyFile(), "utf-8")) as string[];
}

describe("search history persistence", () => {
  test("records queries newest-first with dedupe", async () => {
    addSearchQuery("Dune");
    addSearchQuery("Dune Part Two");
    addSearchQuery("Dune");
    await flushSearchHistoryForTest();
    expect(getSearchHistory()).toEqual(["Dune", "Dune Part Two"]);
    expect(readDisk()).toEqual(["Dune", "Dune Part Two"]);
  });

  test("survives a restart by reloading from disk", async () => {
    addSearchQuery("Frieren");
    await flushSearchHistoryForTest();
    clearSearchHistoryCacheForTest();
    expect(getSearchHistory()).toEqual(["Frieren"]);
  });

  test("a second session's appends merge instead of overwriting", async () => {
    addSearchQuery("session-one");
    await flushSearchHistoryForTest();
    // A second process would read the same file with a cold cache.
    clearSearchHistoryCacheForTest();
    addSearchQuery("session-two");
    await flushSearchHistoryForTest();
    expect(getSearchHistory()).toEqual(["session-two", "session-one"]);
    expect(readDisk()).toEqual(["session-two", "session-one"]);
  });

  test("returned history is a copy callers cannot corrupt", () => {
    addSearchQuery("Dune");
    const exposed: string[] = [...getSearchHistory()];
    exposed.push("injected");
    expect(getSearchHistory()).toEqual(["Dune"]);
  });

  test("blank queries are ignored", () => {
    addSearchQuery("   ");
    expect(getSearchHistory()).toEqual([]);
  });
});
