import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { kunaiConfigDir } from "@/infra/storage/kunai-paths";
import {
  addSearchQuery,
  createSearchHistoryStore,
  flushSearchHistory,
  getSearchHistory,
  refreshSearchHistory,
} from "@/services/persistence/search-history";

import { applyStorageRootEnv } from "../../../helpers/storage-env";

let homeDir: string;
let restore: () => void;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "kunai-search-history-"));
  restore = applyStorageRootEnv(homeDir);
});

afterEach(async () => {
  await flushSearchHistory().catch(() => {});
  restore();
  rmSync(homeDir, { recursive: true, force: true });
});

function historyFile(): string {
  return join(kunaiConfigDir(), "search-history.json");
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
    await flushSearchHistory();
    expect(getSearchHistory()).toEqual(["Dune", "Dune Part Two"]);
    expect(readDisk()).toEqual(["Dune", "Dune Part Two"]);
  });

  test("survives a restart by reloading from disk", async () => {
    addSearchQuery("Frieren");
    await flushSearchHistory();
    const restarted = createSearchHistoryStore(() => historyFile());
    expect(restarted.get()).toEqual([]);
    await restarted.refresh();
    expect(restarted.get()).toEqual(["Frieren"]);
  });

  test("a second session's appends merge instead of overwriting", async () => {
    addSearchQuery("session-one");
    await flushSearchHistory();
    // A second process would read the same file with a cold cache.
    addSearchQuery("session-two");
    await flushSearchHistory();
    expect(getSearchHistory()).toEqual(["session-two", "session-one"]);
    expect(readDisk()).toEqual(["session-two", "session-one"]);
  });

  test("returned history is a copy callers cannot corrupt", () => {
    addSearchQuery("Dune");
    // SAFETY: deliberately mutate the returned readonly view to test isolation.
    const exposed = getSearchHistory() as string[];
    exposed.push("injected");
    expect(getSearchHistory()).toEqual(["Dune"]);
  });

  test("blank queries are ignored", () => {
    addSearchQuery("   ");
    expect(getSearchHistory()).toEqual([]);
  });
  test("a queued write keeps the profile captured when the query was added", async () => {
    const firstPath = historyFile();
    addSearchQuery("profile-one");
    const secondRoot = mkdtempSync(join(tmpdir(), "kunai-history-other-"));
    const undoSecond = applyStorageRootEnv(secondRoot);
    const secondPath = historyFile();
    try {
      await flushSearchHistory();
      expect(existsSync(secondPath)).toBe(false);
      expect(JSON.parse(readFileSync(firstPath, "utf8"))).toEqual(["profile-one"]);
    } finally {
      undoSecond();
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  test("reads a sibling session's fresh history instead of a stale cache", async () => {
    addSearchQuery("old");
    await flushSearchHistory();
    writeFileSync(historyFile(), JSON.stringify(["other-session", "old"]));
    expect(getSearchHistory()).toEqual(["old"]);
    await refreshSearchHistory();
    expect(getSearchHistory()).toEqual(["other-session", "old"]);
  });

  test("independent writers preserve concurrent appends under one file lock", async () => {
    const file = historyFile();
    const first = createSearchHistoryStore(() => file);
    const second = createSearchHistoryStore(() => file);
    first.add("first-session");
    second.add("second-session");
    await Promise.all([first.flush(), second.flush()]);
    await first.refresh();
    expect([...first.get()].sort()).toEqual(["first-session", "second-session"]);
    expect(readDisk().sort()).toEqual(["first-session", "second-session"]);
  });

  test("reads return snapshots without accessing a deleted file until refresh", async () => {
    const file = historyFile();
    const store = createSearchHistoryStore(() => file);
    store.add("cached");
    await store.flush();
    rmSync(file);
    expect(store.get()).toEqual(["cached"]);
    await store.refresh();
    expect(store.get()).toEqual([]);
  });

  test("a refresh notifies an active reader about sibling appends", async () => {
    const store = createSearchHistoryStore(() => historyFile());
    let notices = 0;
    const unsubscribe = store.subscribe(() => notices++);
    const parent = join(historyFile(), "..");
    mkdirSync(parent, { recursive: true });
    writeFileSync(historyFile(), JSON.stringify(["sibling"]));
    await store.refresh();
    expect(store.get()).toEqual(["sibling"]);
    expect(notices).toBe(1);
    unsubscribe();
    await store.refresh();
    expect(notices).toBe(1);
  });

  test("a malformed history is preserved rather than overwritten", async () => {
    addSearchQuery("seed");
    await flushSearchHistory();
    writeFileSync(historyFile(), "broken fixture");
    addSearchQuery("new-query");
    await expect(flushSearchHistory()).rejects.toThrow("Invalid search history data");
    expect(readFileSync(historyFile(), "utf8")).toBe("broken fixture");
  });
});
